# Rill Preview Culling Implementation Plan

> **For implementers:** Work through this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Today previews calm and scannable by removing raw HTML, trimming noisy feed bodies, and showing only useful two-line plain-text excerpts.

**Architecture:** Fix this at two layers. First, normalize feed summaries into plain text during ingestion so future entries store clean preview text while Reader still keeps sanitized HTML. Second, defensively cull Today excerpts at render time so existing IndexedDB and D1 rows with raw HTML stop breaking the UI immediately.

**Tech Stack:** TypeScript, React, Vitest, `htmlparser2`, existing Rill feed parser and Notebook UI.

---

## Interpreted Ask

The screenshot shows Today rows displaying literal feed HTML such as `<p>`, `<a href=...>`, `rel=`, and closing tags inside the preview. The preview also runs for many lines, so Today stops being a finite scan surface and becomes a messy raw-content dump.

The fix should not remove Reader content. Reader should still render sanitized feed HTML. The Today list should show one of these:

1. a short, clean, plain-text excerpt, capped at about 180 characters and two visual lines;
2. no excerpt when the feed does not provide useful preview text.

No raw tags, attributes, URLs from anchor markup, or whole article bodies should appear in Today row previews.

## Scope

In scope:

- RSS descriptions that contain HTML or escaped HTML.
- Atom summaries/content that contain HTML.
- JSON Feed summaries that contain HTML.
- Existing cached rows that already have bad `summary_text`.
- Today row visual culling on desktop and mobile.

Out of scope:

- Full-text extraction.
- Generated summaries.
- Ranking or recommendation changes.
- Reader typography changes.
- Database migration. Defensive rendering handles old rows.

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `src/shared/feed/sanitize.ts` | Modify | Add HTML-to-plain-text helper used by parser tests and ingestion. |
| `src/shared/feed/parse.ts` | Modify | Store plain-text `summary_text` and `content_text` when feed fields contain HTML. |
| `tests/feed/parse.test.ts` | Modify | Prove RSS/Atom/JSON summaries do not store raw tags in preview fields. |
| `src/client/views/entryExcerpt.ts` | Create | Defensive Today excerpt cleaner and truncator for cached bad rows. |
| `src/client/views/TodayView.tsx` | Modify | Use `entryExcerpt()` and render `.entry-excerpt` only when useful. |
| `src/client/styles.css` | Modify | Clamp Today excerpts to two lines on desktop and mobile. |
| `tests/client/entryExcerpt.test.ts` | Create | Unit-test excerpt cleaning, truncation, duplicate-title hiding, and raw-tag defense. |
| `tests/client/today-reader.test.tsx` | Modify | Prove Today never renders raw HTML snippets from feed previews. |
| `docs/qa/manual-acceptance.md` | Modify | Add one manual UX check for compact Today previews. |

## Task 1: Normalize Feed Preview Text at Ingestion

**Files:**
- Modify: `src/shared/feed/sanitize.ts`
- Modify: `src/shared/feed/parse.ts`
- Modify: `tests/feed/parse.test.ts`

- [ ] **Step 1: Add failing parser tests for HTML summaries**

Append these tests to `tests/feed/parse.test.ts`:

```ts
it('stores RSS HTML descriptions as clean preview text while keeping sanitized HTML for Reader', () => {
  const feed = parseFeed(`<?xml version="1.0"?>
    <rss><channel><title>HTML RSS</title><item>
      <title>Raw preview</title>
      <guid>raw-preview</guid>
      <description><![CDATA[<p>Dear readers, <strong>start here</strong>.</p><p><a href="https://example.com/path">Read the guide</a> today.</p>]]></description>
    </item></channel></rss>`, 'application/rss+xml', 'https://example.com/feed.xml');

  expect(feed.entries[0].summary_text).toBe('Dear readers, start here. Read the guide today.');
  expect(feed.entries[0].content_text).toBe('Dear readers, start here. Read the guide today.');
  expect(feed.entries[0].content_html_sanitized).toContain('<strong>start here</strong>');
  expect(feed.entries[0].summary_text).not.toContain('<p>');
  expect(feed.entries[0].summary_text).not.toContain('href=');
});

it('stores JSON Feed HTML summaries as clean preview text', () => {
  const feed = parseFeed(JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON HTML',
    items: [{
      id: 'json-html-1',
      title: 'HTML summary',
      summary: '<p>A short <em>useful</em> preview.</p>',
      content_html: '<p>A short <em>useful</em> preview.</p><p>Reader body.</p>'
    }]
  }), 'application/feed+json', 'https://example.com/feed.json');

  expect(feed.entries[0].summary_text).toBe('A short useful preview.');
  expect(feed.entries[0].summary_text).not.toContain('<em>');
  expect(feed.entries[0].content_html_sanitized).toContain('<p>Reader body.</p>');
});
```

- [ ] **Step 2: Run parser tests to verify RED**

Run:

```bash
npm test -- tests/feed/parse.test.ts
```

Expected: the new tests fail because `summary_text` still contains raw HTML strings.

- [ ] **Step 3: Add plain-text extraction helper**

In `src/shared/feed/sanitize.ts`, add this helper below `sanitizeFeedHtml`:

```ts
function collectText(node: AnyNode, parts: string[]): void {
  if (node.type === 'text') {
    const text = 'data' in node ? node.data : '';
    if (text.trim()) parts.push(text);
    return;
  }
  if (isElement(node) && ['p', 'div', 'br', 'li', 'blockquote', 'h1', 'h2', 'h3'].includes(node.name.toLowerCase())) {
    parts.push(' ');
  }
  const children = 'children' in node ? node.children ?? [] : [];
  for (const child of children) collectText(child, parts);
  if (isElement(node) && ['p', 'div', 'li', 'blockquote'].includes(node.name.toLowerCase())) {
    parts.push(' ');
  }
}

export function htmlToPlainText(html: string): string {
  const document = parseDocument(html, { decodeEntities: true });
  const parts: string[] = [];
  for (const child of document.children) collectText(child, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function cleanFeedText(value: string | null): string | null {
  if (!value) return null;
  const text = /<[^>]+>/.test(value) ? htmlToPlainText(value) : value;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}
```

- [ ] **Step 4: Use clean text in parser output**

Update imports in `src/shared/feed/parse.ts`:

```ts
import { cleanFeedText, extractRemoteImages, htmlToPlainText, sanitizeFeedHtml } from './sanitize';
```

Replace `contentFrom` with:

```ts
function contentFrom(html: string | null, text: string | null) {
  const rawHtml = html;
  const sanitized = rawHtml ? sanitizeFeedHtml(rawHtml) : null;
  const remoteImages = rawHtml ? extractRemoteImages(rawHtml) : [];
  const plainText = rawHtml ? htmlToPlainText(rawHtml) : cleanFeedText(text);
  return {
    content_html_raw: rawHtml,
    content_html_sanitized: sanitized,
    content_text: plainText,
    has_remote_images: remoteImages.length > 0 ? 1 as const : 0 as const,
    remote_image_urls: remoteImages
  };
}
```

In `parseRss`, replace:

```ts
summary_text: summary,
```

with:

```ts
summary_text: cleanFeedText(summary),
```

In `parseAtom`, replace:

```ts
summary_text: summary,
```

with:

```ts
summary_text: cleanFeedText(summary),
```

In `parseJsonFeed`, replace:

```ts
summary_text: item.summary ?? null,
```

with:

```ts
summary_text: cleanFeedText(item.summary ?? null),
```

- [ ] **Step 5: Run parser tests to verify GREEN**

Run:

```bash
npm test -- tests/feed/parse.test.ts tests/feed/sanitize.test.ts
```

Expected: all parser and sanitizer tests pass.

- [ ] **Step 6: Commit parser normalization**

Run:

```bash
git add src/shared/feed/sanitize.ts src/shared/feed/parse.ts tests/feed/parse.test.ts
git commit -m "fix: normalize feed preview text"
```

## Task 2: Add a Defensive Today Excerpt Helper

**Files:**
- Create: `src/client/views/entryExcerpt.ts`
- Create: `tests/client/entryExcerpt.test.ts`

- [ ] **Step 1: Write failing excerpt tests**

Create `tests/client/entryExcerpt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { entryExcerpt } from '../../src/client/views/entryExcerpt';
import type { ReadingEntry } from '../../src/client/views/TodayView';

function entry(overrides: Partial<ReadingEntry> = {}): ReadingEntry {
  return {
    id: 'entry-1',
    feed_id: 'feed-1',
    stable_external_id: 'entry-1',
    canonical_url: 'https://example.com/entry-1',
    title: 'Quiet title',
    author: null,
    published_at: 1,
    updated_at_feed: null,
    summary_text: null,
    content_text: null,
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    source_title: 'Notebook Letters',
    read_at: null,
    saved_at: null,
    archived_at: null,
    last_opened_at: null,
    ...overrides
  };
}

describe('entryExcerpt', () => {
  it('strips raw HTML and attributes from cached feed summaries', () => {
    const excerpt = entryExcerpt(entry({
      summary_text: '<p>Dear followers, <a href="https://example.com">start here</a>.</p><p>Second sentence.</p>'
    }));

    expect(excerpt).toBe('Dear followers, start here. Second sentence.');
    expect(excerpt).not.toContain('<p>');
    expect(excerpt).not.toContain('href=');
  });

  it('truncates long previews at a word boundary', () => {
    const excerpt = entryExcerpt(entry({
      summary_text: 'This is a long preview '.repeat(20)
    }), 90);

    expect(excerpt.length).toBeLessThanOrEqual(91);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toContain('  ');
  });

  it('hides duplicate or empty preview text', () => {
    expect(entryExcerpt(entry({ title: 'Same text', summary_text: 'Same text' }))).toBeNull();
    expect(entryExcerpt(entry({ summary_text: '<p></p>' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run excerpt tests to verify RED**

Run:

```bash
npm test -- tests/client/entryExcerpt.test.ts
```

Expected: FAIL because `src/client/views/entryExcerpt.ts` does not exist.

- [ ] **Step 3: Implement excerpt culling**

Create `src/client/views/entryExcerpt.ts`:

```ts
import type { ReadingEntry } from './TodayView';

const DEFAULT_MAX_CHARS = 180;

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function textFromMaybeHtml(value: string): string {
  if (!/<[^>]+>/.test(value)) return normalize(value);
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(`<main>${value}</main>`, 'text/html');
    return normalize(parsed.body.textContent ?? '');
  }
  return normalize(value.replace(/<[^>]*>/g, ' '));
}

function truncateAtWord(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const sliced = value.slice(0, maxChars + 1);
  const boundary = sliced.lastIndexOf(' ');
  const trimmed = sliced.slice(0, boundary > 40 ? boundary : maxChars).trim();
  return `${trimmed}…`;
}

export function entryExcerpt(entry: ReadingEntry, maxChars = DEFAULT_MAX_CHARS): string | null {
  const candidate = entry.summary_text ?? entry.content_text;
  if (!candidate) return null;
  const cleaned = textFromMaybeHtml(candidate);
  if (!cleaned) return null;
  if (entry.title && cleaned.toLowerCase() === entry.title.toLowerCase()) return null;
  return truncateAtWord(cleaned, maxChars);
}
```

- [ ] **Step 4: Run excerpt tests to verify GREEN**

Run:

```bash
npm test -- tests/client/entryExcerpt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit excerpt helper**

Run:

```bash
git add src/client/views/entryExcerpt.ts tests/client/entryExcerpt.test.ts
git commit -m "fix: cull today excerpts"
```

## Task 3: Wire Today Rows to Culled Excerpts

**Files:**
- Modify: `src/client/views/TodayView.tsx`
- Modify: `src/client/styles.css`
- Modify: `tests/client/today-reader.test.tsx`

- [ ] **Step 1: Add failing Today UI regression**

Append this test to the `Today and Reader` describe block in `tests/client/today-reader.test.tsx`:

```tsx
it('renders compact plain-text previews in Today', () => {
  const host = render(<TodayView entries={[entry('raw-html', {
    title: 'New Year, New Digital You',
    summary_text: '<p>Dear followers of The Opt Out Project,</p><p>Today I announce the start of <a href="https://example.com">Take Back Your Digital Footprint</a>.</p>'.repeat(8)
  })]} onOpenEntry={() => undefined} />);

  const excerpt = host.querySelector('.entry-excerpt');
  expect(excerpt?.textContent).toContain('Dear followers of The Opt Out Project');
  expect(excerpt?.textContent).not.toContain('<p>');
  expect(excerpt?.textContent).not.toContain('href=');
  expect(excerpt!.textContent!.length).toBeLessThanOrEqual(181);
});
```

- [ ] **Step 2: Run Today UI tests to verify RED**

Run:

```bash
npm test -- tests/client/today-reader.test.tsx
```

Expected: FAIL because Today still renders `summary_text` directly and has no `.entry-excerpt` class.

- [ ] **Step 3: Use `entryExcerpt()` in TodayView**

In `src/client/views/TodayView.tsx`, add:

```ts
import { entryExcerpt } from './entryExcerpt';
```

Inside `EntryRow`, add before `return`:

```ts
const excerpt = entryExcerpt(entry);
```

Replace:

```tsx
{entry.summary_text ? <p>{entry.summary_text}</p> : null}
```

with:

```tsx
{excerpt ? <p className="entry-excerpt">{excerpt}</p> : null}
```

- [ ] **Step 4: Clamp excerpts in CSS**

In `src/client/styles.css`, replace the `.entry-row p` selector with `.entry-excerpt` and make it two-line clamped:

```css
.entry-excerpt {
  max-width: 760px;
  display: -webkit-box;
  overflow: hidden;
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 400;
  line-height: 19px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
```

In the mobile section, replace `.entry-row p` with:

```css
  .entry-excerpt {
    font-size: 12px;
    line-height: 18px;
    -webkit-line-clamp: 2;
  }
```

- [ ] **Step 5: Run UI tests to verify GREEN**

Run:

```bash
npm test -- tests/client/entryExcerpt.test.ts tests/client/today-reader.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Today wiring**

Run:

```bash
git add src/client/views/TodayView.tsx src/client/styles.css tests/client/today-reader.test.tsx
git commit -m "fix: render compact today previews"
```

## Task 4: Manual UX Gate and Final Verification

**Files:**
- Modify: `docs/qa/manual-acceptance.md`

- [ ] **Step 1: Add manual preview acceptance check**

In `docs/qa/manual-acceptance.md`, add this check after the Today check:

```md
- Today previews are compact: no raw `<p>`, `href=`, `target=`, or long article-body dumps appear in the list. Each preview is plain text and visually capped at two lines.
```

- [ ] **Step 2: Run full automated verification**

Run:

```bash
npm run verify
npm run test:e2e
```

Expected: typecheck, all Vitest tests, build, privacy lint, and Playwright all pass.

- [ ] **Step 3: Run final hygiene scans**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
markers = [
  'TO' + 'DO', 'TB' + 'D', 'XX' + 'X', 'del' + 've', 'Further' + 'more',
  'Addition' + 'ally', 'More' + 'over', 'best-' + 'in-class', 'world-' + 'class',
  'cutting-' + 'edge', 'lo' + 'rem', 'mag' + 'ical', 'seam' + 'less'
]
paths = [Path('src'), Path('tests'), Path('docs/qa'), Path('README.md'), Path('CONTRIBUTING.md')]
for root in paths:
  files = [root] if root.is_file() else [p for p in root.rglob('*') if p.is_file()]
  for file in files:
    text = file.read_text(errors='ignore')
    for marker in markers:
      if marker in text:
        print(f'{file}: contains {marker}')
PY
rg -n "fonts\.googleapis|googletagmanager|google-analytics|segment|mixpanel|<script[^>]+https?://|<link[^>]+stylesheet[^>]+https?://" src tests public dist || true
git diff --check
git status --short --ignored
```

Expected: no filler-copy or privacy hits, no diff whitespace errors, no untracked scratch files besides ignored build/test artifacts.

- [ ] **Step 4: Manually verify with Opt Out Project**

Run:

```bash
npm run build
npx wrangler dev
```

Open `http://localhost:8787`, unlock, subscribe to `https://www.optoutproject.net/feed/`, and confirm Today rows look like Notebook list rows again:

- source and timestamp are compact;
- title is readable;
- preview is plain text;
- preview is capped at two lines;
- raw HTML tags and anchor attributes are absent;
- opening Reader still shows readable article content.

- [ ] **Step 5: Commit manual gate update**

Run:

```bash
git add docs/qa/manual-acceptance.md
git commit -m "docs: add preview culling qa gate"
```

## Definition of Done

- Today previews never show raw HTML tags or attributes.
- Today previews never show a whole article body.
- Existing cached rows are cleaned defensively at render time.
- Newly ingested RSS, Atom, and JSON Feed rows store clean plain-text preview fields.
- Reader still renders sanitized feed HTML.
- Opt Out Project rows become compact enough to scan.
- `npm run verify` and `npm run test:e2e` pass.

## Self-Review Notes

- Spec coverage: this plan addresses the screenshot issue directly and keeps Reader behavior intact.
- Privacy: no new network calls, no external assets, no image-policy change.
- Data migration: none needed because render-time culling handles existing cache and D1 rows.
- Risk: `summary_text` cleanup changes future stored text, but only from raw HTML to equivalent plain text.
