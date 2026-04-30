# Rill Public Article Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit public full-article loading in Reader for feed entries that only contain teaser content.

**Architecture:** The client shows a "Load full article" action for teaser entries with a canonical URL. The Worker owns extraction through an authenticated `POST /api/entries/:id/extract` route, fetches the public page without user credentials, extracts readable content, sanitizes it, updates the existing entry row, and returns the updated entry. The normal cache/sync path continues to carry entry updates to IndexedDB.

**Tech Stack:** TypeScript, React, Vitest, Cloudflare Workers, D1, existing feed sanitizer, `@mozilla/readability`, `linkedom`.

---

## Scope Check

This plan implements one subsystem: public article extraction for Reader. It does not add per-source settings, background extraction, paywall handling, a new migration, or an external extraction service.

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `package.json` | Modify | Add extraction dependencies. |
| `package-lock.json` | Modify | Lock dependency versions after `npm install`. |
| `src/shared/contentHash.ts` | Create | Shared deterministic content hash for feed ingestion and extraction updates. |
| `src/worker/feedFetch.ts` | Modify | Use the shared content hash helper instead of a private copy. |
| `src/worker/articleExtract.ts` | Create | Public URL validation, bounded fetch, Readability extraction, sanitizer handoff. |
| `src/worker/db.ts` | Modify | Add `updateEntryExtractedContent` to update existing entry content for a subscribed user. |
| `src/worker/routes/entries.ts` | Modify | Add `POST /api/entries/:id/extract`. |
| `tests/worker/fakeRillD1.ts` | Modify | Teach the fake D1 helper how to apply extraction update SQL. |
| `tests/fixtures/readable-article.html` | Create | Fixture page with article content, unsafe markup, and remote image. |
| `tests/worker/articleExtract.test.ts` | Create | Unit tests for extraction success, unsafe URL rejection, fetch failure, and no readable content. |
| `tests/worker/entries.test.ts` | Modify | Route-level extraction tests for ownership, no canonical URL, and mutation behavior. |
| `src/client/api.ts` | Modify | Add `extractEntryContent(entryId)`. |
| `src/client/App.tsx` | Modify | Wire extraction status, errors, and updated entry state into Reader. |
| `src/client/views/readerContent.ts` | Create | Teaser detection helpers for Reader. |
| `src/client/views/ReaderView.tsx` | Modify | Show load, loading, and failure states without hiding Open Original. |
| `src/client/styles.css` | Modify | Add compact Reader extraction notice styles. |
| `tests/client/reader-content.test.ts` | Create | Unit tests for teaser detection. |
| `tests/client/today-reader.test.tsx` | Modify | Reader integration tests for success, failure, and remote image hiding after extraction. |

## Task 1: Add Dependencies And Shared Hash

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/shared/contentHash.ts`
- Modify: `src/worker/feedFetch.ts`

- [ ] **Step 1: Install extraction dependencies**

Run:

```bash
npm install @mozilla/readability linkedom
```

Expected: `package.json` gains both dependencies and `package-lock.json` is updated.

- [ ] **Step 2: Create the shared content hash helper**

Create `src/shared/contentHash.ts`:

```ts
export function contentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function entryContentHash(parts: { title?: string | null; content_text?: string | null; content_html_sanitized?: string | null }): string {
  return contentHash(`${parts.title ?? ''}|${parts.content_text ?? ''}|${parts.content_html_sanitized ?? ''}`);
}
```

- [ ] **Step 3: Replace the private hash in feed ingestion**

In `src/worker/feedFetch.ts`, add:

```ts
import { entryContentHash } from '../shared/contentHash';
```

Delete the local `textHash` function:

```ts
function textHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
```

Replace:

```ts
content_hash: textHash(`${entry.title ?? ''}|${entry.content_text ?? ''}|${entry.content_html_sanitized ?? ''}`),
```

with:

```ts
content_hash: entryContentHash(entry),
```

- [ ] **Step 4: Run the feed ingestion tests**

Run:

```bash
npm test -- tests/worker/feedFetch.test.ts tests/worker/add-source-ingestion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json package-lock.json src/shared/contentHash.ts src/worker/feedFetch.ts
git commit -m "chore: add article extraction dependencies"
```

## Task 2: Build The Worker Extraction Helper

**Files:**
- Create: `src/worker/articleExtract.ts`
- Create: `tests/fixtures/readable-article.html`
- Create: `tests/worker/articleExtract.test.ts`

- [ ] **Step 1: Add the readable article fixture**

Create `tests/fixtures/readable-article.html`:

```html
<!doctype html>
<html>
  <head>
    <title>Readable fixture</title>
    <meta name="description" content="A readable fixture page.">
  </head>
  <body>
    <nav>Navigation should not become article content.</nav>
    <main>
      <article>
        <h1>The Robots Make the Predictions</h1>
        <p>Polymarket bots, OBDC II tenders, Rivian CEO pay, Claude capital allocation, World Liberty and Boardy.</p>
        <p>This is the first full paragraph that should appear in Rill Reader after extraction.</p>
        <p>This is the second full paragraph, long enough to pass the readable-content threshold for the test fixture.</p>
        <img src="https://images.example/full-article.png" alt="Chart">
        <script>window.evil = true;</script>
      </article>
    </main>
  </body>
</html>
```

- [ ] **Step 2: Write failing extraction helper tests**

Create `tests/worker/articleExtract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { extractPublicArticle, isPublicHttpUrl } from '../../src/worker/articleExtract';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

describe('article extraction', () => {
  it('extracts and sanitizes readable public article content', async () => {
    const fetcher = vi.fn(async () => new Response(fixture('readable-article.html'), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    }));

    const result = await extractPublicArticle('https://example.com/robots', { fetcher, timeoutMs: 1000, maxBytes: 200_000 });

    expect(result.title).toBe('The Robots Make the Predictions');
    expect(result.content_text).toContain('first full paragraph');
    expect(result.content_html_sanitized).toContain('<p>This is the first full paragraph');
    expect(result.content_html_sanitized).not.toContain('<script');
    expect(result.has_remote_images).toBe(1);
    expect(fetcher).toHaveBeenCalledWith('https://example.com/robots', expect.objectContaining({
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal)
    }));
  });

  it('rejects private and malformed urls before fetch', () => {
    expect(isPublicHttpUrl('https://example.com/post')).toBe(true);
    expect(isPublicHttpUrl('http://localhost/post')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/post')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.4/post')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.2/post')).toBe(false);
    expect(isPublicHttpUrl('file:///tmp/post')).toBe(false);
    expect(isPublicHttpUrl('not a url')).toBe(false);
  });

  it('reports upstream fetch failures without extracted content', async () => {
    const fetcher = vi.fn(async () => new Response('blocked', { status: 403 }));

    await expect(extractPublicArticle('https://example.com/blocked', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'article_fetch_failed' });
  });

  it('reports pages with no readable content', async () => {
    const fetcher = vi.fn(async () => new Response('<html><body><p>tiny</p></body></html>', {
      headers: { 'content-type': 'text/html' }
    }));

    await expect(extractPublicArticle('https://example.com/tiny', { fetcher, timeoutMs: 1000, maxBytes: 200_000 }))
      .rejects.toMatchObject({ code: 'article_not_readable' });
  });
});
```

- [ ] **Step 3: Run the new tests to verify RED**

Run:

```bash
npm test -- tests/worker/articleExtract.test.ts
```

Expected: FAIL because `src/worker/articleExtract.ts` does not exist.

- [ ] **Step 4: Create the extraction helper**

Create `src/worker/articleExtract.ts`:

```ts
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { extractRemoteImages, htmlToPlainText, sanitizeFeedHtml } from '../shared/feed/sanitize';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_500_000;
const MIN_TEXT_LENGTH = 180;

export class ArticleExtractionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message);
    this.name = 'ArticleExtractionError';
  }
}

export interface ExtractedArticle {
  title: string | null;
  content_html_sanitized: string;
  content_text: string;
  has_remote_images: 0 | 1;
}

export interface ExtractPublicArticleOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function privateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
}

export function isPublicHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    if (privateIpv4(hostname) || privateIpv6(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer)
  };
}

function ensureHtmlResponse(response: Response, maxBytes: number): void {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) {
    throw new ArticleExtractionError('article_too_large', 'The public article page is too large to load in Rill.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('html')) {
    throw new ArticleExtractionError('article_not_html', 'The original page did not return readable HTML.');
  }
}

function readabilityDocument(html: string, url: string): Document {
  const { document } = parseHTML(html);
  Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
  return document as unknown as Document;
}

export async function extractPublicArticle(url: string, options: ExtractPublicArticleOptions = {}): Promise<ExtractedArticle> {
  if (!isPublicHttpUrl(url)) {
    throw new ArticleExtractionError('invalid_article_url', 'The original article URL is not a public http or https URL.', 400);
  }

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeout = timeoutSignal(timeoutMs);

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: new Headers({
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'user-agent': 'Rill Reader'
      }),
      redirect: 'follow',
      signal: timeout.signal
    });
  } catch (error) {
    throw new ArticleExtractionError(
      error instanceof DOMException && error.name === 'AbortError' ? 'article_fetch_timeout' : 'article_fetch_failed',
      'Rill could not fetch the public article page.'
    );
  } finally {
    timeout.cancel();
  }

  if (!response.ok) {
    throw new ArticleExtractionError('article_fetch_failed', 'Rill could not fetch the public article page.', response.status);
  }
  ensureHtmlResponse(response, maxBytes);

  const html = await response.text();
  if (html.length > maxBytes) {
    throw new ArticleExtractionError('article_too_large', 'The public article page is too large to load in Rill.');
  }

  const article = new Readability(readabilityDocument(html, url), { charThreshold: MIN_TEXT_LENGTH }).parse();
  const content = article?.content?.trim() ?? '';
  const text = article?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!content || text.length < MIN_TEXT_LENGTH) {
    throw new ArticleExtractionError('article_not_readable', 'Rill could not find a readable article body on the public page.');
  }

  const sanitized = sanitizeFeedHtml(content);
  const contentText = htmlToPlainText(sanitized);
  if (contentText.length < MIN_TEXT_LENGTH) {
    throw new ArticleExtractionError('article_not_readable', 'Rill could not find a readable article body on the public page.');
  }

  return {
    title: article?.title?.trim() || null,
    content_html_sanitized: sanitized,
    content_text: contentText,
    has_remote_images: extractRemoteImages(sanitized).length > 0 ? 1 : 0
  };
}
```

- [ ] **Step 5: Run extraction tests to verify GREEN**

Run:

```bash
npm test -- tests/worker/articleExtract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build to verify Worker bundle compatibility**

Run:

```bash
npm run build
```

Expected: PASS. If this fails because `@mozilla/readability` or `linkedom` cannot bundle, stop this task and replace the helper internals with an `htmlparser2` extractor that keeps the same exported `extractPublicArticle`, `ArticleExtractionError`, and `isPublicHttpUrl` API.

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json src/worker/articleExtract.ts tests/fixtures/readable-article.html tests/worker/articleExtract.test.ts
git commit -m "feat: extract public article content"
```

## Task 3: Persist Extracted Content Through The Entries Route

**Files:**
- Modify: `src/worker/db.ts`
- Modify: `src/worker/routes/entries.ts`
- Modify: `tests/worker/fakeRillD1.ts`
- Modify: `tests/worker/entries.test.ts`

- [ ] **Step 1: Add failing route tests**

Append these tests inside the existing `describe('entries routes', () => { ... })` block in `tests/worker/entries.test.ts`:

```ts
  it('extracts public article content for a subscribed entry and does not store raw page html', async () => {
    const db = seededDb();
    db.entries[0].summary_text = 'Short teaser';
    db.entries[0].content_text = 'Short teaser';
    db.entries[0].content_html_sanitized = null;
    const page = '<html><body><article><h1>Full article</h1><p>This is a full public article body with enough useful text for the extractor to accept it in Reader.</p><p>Second paragraph with more useful detail for the local reading cache.</p><script>bad()</script></article></body></html>';
    globalThis.fetch = (async () => new Response(page, { headers: { 'content-type': 'text/html' } })) as typeof fetch;

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', { method: 'POST' }), envFor(db), () => 5000);
    const payload = await response!.json() as { ok: true; entry: Entry };

    expect(response?.status).toBe(200);
    expect(payload.entry.content_text).toContain('full public article body');
    expect(payload.entry.content_html_sanitized).toContain('<p>This is a full public article body');
    expect(payload.entry.content_html_sanitized).not.toContain('<script');
    expect(payload.entry.content_html_raw).toBeNull();
    expect(db.entries[0].updated_at).toBe(5000);
    expect(db.entries[0].content_hash).not.toBeNull();
  });

  it('rejects extraction for entries without a canonical url', async () => {
    const db = seededDb();
    db.entries[0].canonical_url = null;

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', { method: 'POST' }), envFor(db), () => 5000);

    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toMatchObject({
      ok: false,
      code: 'missing_article_url',
      message: 'This entry does not have an original article URL.'
    });
  });

  it('rejects extraction for entries outside the signed-in user subscriptions', async () => {
    const db = seededDb();
    db.subscriptions = [];

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', { method: 'POST' }), envFor(db), () => 5000);

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({ ok: false, code: 'entry_not_found' });
  });
```

- [ ] **Step 2: Run route tests to verify RED**

Run:

```bash
npm test -- tests/worker/entries.test.ts
```

Expected: FAIL because `/api/entries/:id/extract` is not implemented.

- [ ] **Step 3: Add the DB update helper**

In `src/worker/db.ts`, add this import:

```ts
import { entryContentHash } from '../shared/contentHash';
```

Add this function after `getEntryForUser`:

```ts
export async function updateEntryExtractedContent(
  db: D1Database,
  userId: string,
  entryId: string,
  content: { title: string | null; content_html_sanitized: string; content_text: string; has_remote_images: 0 | 1 },
  now: UnixMs
): Promise<EntryWithState | null> {
  const existing = await getEntryForUser(db, userId, entryId);
  if (!existing) return null;
  const title = existing.title ?? content.title;
  await db.prepare(`
    UPDATE entries
    SET title = ?,
      content_text = ?,
      content_html_sanitized = ?,
      has_remote_images = ?,
      content_hash = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    title,
    content.content_text,
    content.content_html_sanitized,
    content.has_remote_images,
    entryContentHash({ title, content_text: content.content_text, content_html_sanitized: content.content_html_sanitized }),
    now,
    entryId
  ).run();
  return getEntryForUser(db, userId, entryId);
}
```

- [ ] **Step 4: Teach the fake D1 helper the update SQL**

In `tests/worker/fakeRillD1.ts`, add this line inside `FakeStatement.run()` after the subscription update branch:

```ts
    if (sqlIncludes(this.sql, 'UPDATE entries')) this.updateEntryExtractedContent();
```

Add this private method to `FakeStatement`:

```ts
  private updateEntryExtractedContent(): void {
    const [title, content_text, content_html_sanitized, has_remote_images, content_hash, updated_at, id] = this.args as [string | null, string | null, string | null, 0 | 1, string | null, UnixMs, string];
    const entry = this.db.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    entry.title = title;
    entry.content_text = content_text;
    entry.content_html_sanitized = content_html_sanitized;
    entry.has_remote_images = has_remote_images;
    entry.content_hash = content_hash;
    entry.updated_at = updated_at;
  }
```

- [ ] **Step 5: Add the extraction route**

In `src/worker/routes/entries.ts`, change the imports:

```ts
import { ArticleExtractionError, extractPublicArticle } from '../articleExtract';
import { getEntryForUser, listTodayEntries, patchEntryState, searchEntries, updateEntryExtractedContent } from '../db';
```

Add this route before the state route:

```ts
  const extractMatch = url.pathname.match(/^\/api\/entries\/([^/]+)\/extract$/);
  if (extractMatch && request.method === 'POST') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const entryId = decodeURIComponent(extractMatch[1]);
    const entry = await getEntryForUser(env.DB, user.id, entryId);
    if (!entry) return json({ ok: false, code: 'entry_not_found', message: 'Entry not found.' }, { status: 404 });
    if (!entry.canonical_url) return json({ ok: false, code: 'missing_article_url', message: 'This entry does not have an original article URL.' }, { status: 422 });
    try {
      const extracted = await extractPublicArticle(entry.canonical_url);
      const updated = await updateEntryExtractedContent(env.DB, user.id, entryId, extracted, clock());
      if (!updated) return json({ ok: false, code: 'entry_not_found', message: 'Entry not found.' }, { status: 404 });
      return json({ ok: true, entry: updated });
    } catch (error) {
      if (error instanceof ArticleExtractionError) {
        return json({ ok: false, code: error.code, message: error.message }, { status: error.status });
      }
      return json({ ok: false, code: 'article_extract_failed', message: 'Rill could not load the public article.' }, { status: 422 });
    }
  }
```

- [ ] **Step 6: Run route tests to verify GREEN**

Run:

```bash
npm test -- tests/worker/entries.test.ts tests/worker/articleExtract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/worker/db.ts src/worker/routes/entries.ts tests/worker/fakeRillD1.ts tests/worker/entries.test.ts
git commit -m "feat: add article extraction route"
```

## Task 4: Add Client API And Teaser Detection

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/views/readerContent.ts`
- Create: `tests/client/reader-content.test.ts`

- [ ] **Step 1: Write failing teaser detection tests**

Create `tests/client/reader-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canLoadFullArticle, readerTextLength } from '../../src/client/views/readerContent';
import type { ReadingEntry } from '../../src/client/views/TodayView';

function entry(overrides: Partial<ReadingEntry> = {}): ReadingEntry {
  return {
    id: 'entry-1',
    feed_id: 'feed-1',
    stable_external_id: 'entry-1',
    canonical_url: 'https://example.com/article',
    title: 'Entry',
    author: null,
    published_at: 1,
    updated_at_feed: null,
    summary_text: 'Short teaser',
    content_text: 'Short teaser',
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    source_title: 'Feed',
    read_at: null,
    saved_at: null,
    archived_at: null,
    last_opened_at: null,
    ...overrides
  };
}

describe('Reader content detection', () => {
  it('allows full article loading for short teaser entries with a canonical url', () => {
    expect(canLoadFullArticle(entry())).toBe(true);
  });

  it('does not offer extraction for entries without an original url', () => {
    expect(canLoadFullArticle(entry({ canonical_url: null }))).toBe(false);
  });

  it('does not offer extraction for entries with enough existing html content', () => {
    const fullHtml = `<p>${'Full article paragraph. '.repeat(80)}</p>`;
    expect(readerTextLength(entry({ content_html_sanitized: fullHtml, content_text: null }))).toBeGreaterThan(800);
    expect(canLoadFullArticle(entry({ content_html_sanitized: fullHtml, content_text: null }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run teaser detection tests to verify RED**

Run:

```bash
npm test -- tests/client/reader-content.test.ts
```

Expected: FAIL because `readerContent.ts` does not exist.

- [ ] **Step 3: Create Reader content helpers**

Create `src/client/views/readerContent.ts`:

```ts
import type { ReadingEntry } from './TodayView';

const FULL_ARTICLE_THRESHOLD = 800;

function normalize(value: string | null): string {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function readerTextLength(entry: Pick<ReadingEntry, 'content_html_sanitized' | 'content_text' | 'summary_text'>): number {
  const htmlLength = normalize(entry.content_html_sanitized).length;
  const textLength = normalize(entry.content_text ?? entry.summary_text).length;
  return Math.max(htmlLength, textLength);
}

export function canLoadFullArticle(entry: Pick<ReadingEntry, 'canonical_url' | 'content_html_sanitized' | 'content_text' | 'summary_text'>): boolean {
  return Boolean(entry.canonical_url) && readerTextLength(entry) < FULL_ARTICLE_THRESHOLD;
}
```

- [ ] **Step 4: Add the client API function**

In `src/client/api.ts`, update the import:

```ts
import type { BootstrapPayload, EntryStatePatch, EntryUserState, EntryWithState, Subscription, SyncPayload, UnixMs } from '../shared/types';
```

Add this function after `patchEntryState`:

```ts
export async function extractEntryContent(entryId: string): Promise<EntryWithState> {
  const response = await fetch(`/api/entries/${encodeURIComponent(entryId)}/extract`, {
    method: 'POST',
    credentials: 'same-origin'
  });
  const payload = await parseJson<{ ok: true; entry: EntryWithState } | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not load the full article.');
  }
  return payload.entry;
}
```

- [ ] **Step 5: Run client unit tests**

Run:

```bash
npm test -- tests/client/reader-content.test.ts tests/client/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/client/api.ts src/client/views/readerContent.ts tests/client/reader-content.test.ts
git commit -m "feat: detect loadable reader teasers"
```

## Task 5: Wire Reader UI To Extraction

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/views/ReaderView.tsx`
- Modify: `src/client/styles.css`
- Modify: `tests/client/today-reader.test.tsx`

- [ ] **Step 1: Add failing Reader integration tests**

In `tests/client/today-reader.test.tsx`, add `vi.unstubAllGlobals();` inside `afterEach`:

```ts
afterEach(() => {
  vi.unstubAllGlobals();
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});
```

Append these tests inside `describe('Today and Reader', () => { ... })`:

```ts
  it('loads a public full article from Reader and keeps Open Original visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      entry: {
        ...entry('teaser', {
          title: 'The Robots Make the Predictions',
          canonical_url: 'https://example.com/robots',
          summary_text: 'Short teaser',
          content_text: 'Short teaser',
          content_html_sanitized: '<p>This is the full article body after extraction.</p><p>Second extracted paragraph.</p>',
          has_remote_images: 0,
          updated_at: 5000
        }),
        read_at: 1000,
        source_title: 'Matt Levine'
      }
    }), { headers: { 'content-type': 'application/json' } })));
    const host = render(<App initialUnlocked initialEntries={[entry('teaser', {
      title: 'The Robots Make the Predictions',
      source_title: 'Matt Levine',
      canonical_url: 'https://example.com/robots',
      summary_text: 'Short teaser',
      content_text: 'Short teaser',
      content_html_sanitized: null
    })]} clock={() => 1000} />);

    click('[data-entry-id="teaser"] .entry-open-button');
    expect(host.textContent).toContain('Load full article');
    expect(host.querySelector<HTMLAnchorElement>('[data-action="open-original"]')?.href).toBe('https://example.com/robots');

    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    expect(host.textContent).toContain('This is the full article body after extraction.');
    expect(host.textContent).not.toContain('Load full article');
    expect(fetch).toHaveBeenCalledWith('/api/entries/teaser/extract', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  });

  it('shows extraction failure without hiding the teaser or original link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      code: 'article_not_readable',
      message: 'Rill could not find a readable article body on the public page.'
    }), { status: 422, headers: { 'content-type': 'application/json' } })));
    const host = render(<App initialUnlocked initialEntries={[entry('blocked', {
      title: 'Blocked article',
      canonical_url: 'https://example.com/blocked',
      summary_text: 'Short teaser',
      content_text: 'Short teaser',
      content_html_sanitized: null
    })]} />);

    click('[data-entry-id="blocked"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    expect(host.textContent).toContain('Rill could not find a readable article body on the public page.');
    expect(host.textContent).toContain('Short teaser');
    expect(host.querySelector<HTMLAnchorElement>('[data-action="open-original"]')?.href).toBe('https://example.com/blocked');
  });

  it('keeps extracted remote images hidden until explicitly loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      entry: {
        ...entry('extracted-image', {
          canonical_url: 'https://example.com/full',
          content_html_sanitized: '<p>Extracted body.</p><img src="https://images.example/chart.png" alt="Chart">',
          has_remote_images: 1,
          updated_at: 6000
        }),
        read_at: 1000,
        source_title: 'Notebook Letters'
      }
    }), { headers: { 'content-type': 'application/json' } })));
    const host = render(<App initialUnlocked initialEntries={[entry('extracted-image', {
      canonical_url: 'https://example.com/full',
      summary_text: 'Short teaser',
      content_text: 'Short teaser',
      content_html_sanitized: null
    })]} />);

    click('[data-entry-id="extracted-image"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    expect(host.textContent).toContain('1 remote image hidden');
    expect(host.querySelectorAll('img[src^="http"]')).toHaveLength(0);
  });
```

- [ ] **Step 2: Run Reader tests to verify RED**

Run:

```bash
npm test -- tests/client/today-reader.test.tsx
```

Expected: FAIL because Reader does not render `data-action="load-full-article"`.

- [ ] **Step 3: Wire extraction state in App**

In `src/client/App.tsx`, update the API import:

```ts
import { extractEntryContent, importOpml, patchSubscription as patchRemoteSubscription, refreshAllSubscriptions, refreshSubscription, removeSubscription } from './api';
```

Add state near the other `useState` declarations:

```ts
  const [extractingEntryIds, setExtractingEntryIds] = useState<Set<string>>(() => new Set());
  const [extractionErrors, setExtractionErrors] = useState<Record<string, string>>({});
```

Add this function before the first render guard:

```ts
  async function loadFullArticle(entryId: string) {
    setExtractingEntryIds((current) => new Set(current).add(entryId));
    setExtractionErrors((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    try {
      const extracted = await extractEntryContent(entryId);
      setEntries((current) => current.map((entry) => entry.id === entryId ? { ...entry, ...extracted } : entry));
      if (runtimeStore) {
        await runtimeStore.put('entries', extracted);
      }
    } catch (error) {
      setExtractionErrors((current) => ({
        ...current,
        [entryId]: error instanceof Error ? error.message : 'Rill could not load the public article.'
      }));
    } finally {
      setExtractingEntryIds((current) => {
        const next = new Set(current);
        next.delete(entryId);
        return next;
      });
    }
  }
```

In the `ReaderView` JSX, add props:

```tsx
          onLoadFullArticle={(entryId) => { void loadFullArticle(entryId); }}
          isLoadingFullArticle={extractingEntryIds.has(selectedEntry.id)}
          fullArticleError={extractionErrors[selectedEntry.id] ?? null}
```

- [ ] **Step 4: Update ReaderView props and UI**

In `src/client/views/ReaderView.tsx`, add:

```ts
import { canLoadFullArticle } from './readerContent';
```

Change `ReaderViewProps` to:

```ts
interface ReaderViewProps {
  entry: ReadingEntry;
  onBack: () => void;
  onSave: (entryId: string) => void;
  onArchive: (entryId: string) => void;
  onMarkUnread: (entryId: string) => void;
  onLoadFullArticle?: (entryId: string) => void;
  isLoadingFullArticle?: boolean;
  fullArticleError?: string | null;
}
```

Change the function signature to:

```ts
export function ReaderView({ entry, onBack, onSave, onArchive, onMarkUnread, onLoadFullArticle, isLoadingFullArticle = false, fullArticleError = null }: ReaderViewProps) {
```

Add this after the `byline` constant:

```ts
  const canExtractArticle = canLoadFullArticle(entry);
```

Add this JSX after the saved note and before the hidden images banner:

```tsx
        {canExtractArticle ? (
          <div className="reader-extraction-banner">
            <p>{fullArticleError ?? 'This feed only provided a short preview.'}</p>
            <button
              type="button"
              data-action="load-full-article"
              disabled={isLoadingFullArticle}
              aria-busy={isLoadingFullArticle}
              onClick={() => onLoadFullArticle?.(entry.id)}
            >
              {isLoadingFullArticle ? 'Loading article' : 'Load full article'}
            </button>
          </div>
        ) : null}
```

- [ ] **Step 5: Add Reader extraction styles**

In `src/client/styles.css`, add after `.reader-state-note`:

```css
.reader-extraction-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: -10px 0 24px;
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--color-sidebar);
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 18px;
}

.reader-extraction-banner p {
  margin: 0;
}

.reader-extraction-banner button {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--color-accent);
  font-weight: 500;
}
```

Inside the mobile media query, add:

```css
  .reader-extraction-banner {
    align-items: flex-start;
  }
```

Inside `@media (hover: hover)`, add `.reader-extraction-banner button:hover` to the same hover color rule as `.hidden-images-banner button:hover`.

- [ ] **Step 6: Run Reader tests to verify GREEN**

Run:

```bash
npm test -- tests/client/reader-content.test.ts tests/client/today-reader.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/client/App.tsx src/client/views/ReaderView.tsx src/client/styles.css tests/client/today-reader.test.tsx
git commit -m "feat: load full articles from reader"
```

## Task 6: Final Verification And Manual Smoke

**Files:**
- Modify only if a verification failure exposes a specific bug in files changed by Tasks 1-5.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- tests/worker/articleExtract.test.ts tests/worker/entries.test.ts tests/client/reader-content.test.ts tests/client/today-reader.test.tsx tests/worker/feedFetch.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run privacy lint**

Run:

```bash
npm run lint:privacy
```

Expected: PASS. If this fails because bundled extraction dependencies include remote URLs or third-party script references, inspect the exact lint output and remove the offending dependency path before proceeding.

- [ ] **Step 6: Run the complete verification command**

Run:

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 7: Manual smoke against local Worker**

Run:

```bash
npm run build
npx wrangler dev
```

Open the local Worker URL, unlock Rill, open a teaser article, click "Load full article", and verify:

- the full article body replaces the teaser;
- "Open Original" remains visible;
- blocked pages show a concise failure note;
- remote images are hidden until explicitly loaded;
- refreshing the app keeps the extracted body after sync.

- [ ] **Step 8: Commit verification fixes or record clean verification**

If fixes were needed, run:

```bash
git add src tests package.json package-lock.json
git commit -m "fix: stabilize article extraction"
```

If no fixes were needed, do not create an empty commit. Record the passing commands in the final implementation message.

## Self-Review Notes

Spec coverage:

- Explicit public-only extraction: Tasks 2 and 3.
- No paywall bypass, cookies, or external service: Tasks 2 and 6.
- Reader load, loading, and unavailable states: Task 5.
- Existing entry storage without migration: Task 3.
- Remote image behavior unchanged: Tasks 2 and 5.
- Rollback without data migration: maintained by File Structure and Task 3.

Placeholder scan:

- No placeholder markers from the planning checklist.
- Every code-writing step includes exact code or exact replacement text.
- Every test step includes command and expected result.

Type consistency:

- `ExtractedArticle`, `ArticleExtractionError`, `extractPublicArticle`, `updateEntryExtractedContent`, `extractEntryContent`, and `canLoadFullArticle` names are consistent across tasks.
