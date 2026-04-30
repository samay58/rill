import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleEntriesRoute } from '../../src/worker/routes/entries';
import type { Env } from '../../src/worker/env';
import type { Entry, EntryUserState } from '../../src/shared/types';
import { entryContentHash } from '../../src/shared/contentHash';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

function envFor(db: FakeRillD1): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

async function cookie(): Promise<string> {
  return createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
}

async function authed(path: string, init: RequestInit = {}): Promise<Request> {
  return new Request(`https://rill.local${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie: await cookie() } });
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    feed_id: 'feed-1',
    stable_external_id: 'entry-1',
    canonical_url: 'https://example.com/entry-1',
    title: 'Quiet defaults',
    author: 'Ada',
    published_at: 100,
    updated_at_feed: null,
    summary_text: 'A calm summary',
    content_text: 'A longer body about local reading.',
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

function state(overrides: Partial<EntryUserState> = {}): EntryUserState {
  return {
    user_id: 'user-1',
    entry_id: 'entry-1',
    read_at: null,
    saved_at: null,
    archived_at: null,
    last_opened_at: null,
    updated_at: 1,
    ...overrides
  };
}

function seededDb(): FakeRillD1 {
  const db = new FakeRillD1();
  db.feeds.push(feed());
  db.subscriptions.push(subscription());
  db.entries.push(entry());
  return db;
}

describe('entries routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts public article content into a subscribed entry', async () => {
    const db = seededDb();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture('readable-article.html'), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })));

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', {
      method: 'POST'
    }), envFor(db), () => 5000);
    const payload = await response!.json() as { ok: true; entry: Entry };

    expect(response?.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.entry).toMatchObject({
      id: 'entry-1',
      title: 'Quiet defaults',
      updated_at: 5000,
      content_html_raw: null
    });
    expect(payload.entry.content_text).toContain('first full paragraph');
    expect(payload.entry.content_html_sanitized).toContain('<p>This is the first full paragraph');
    expect(payload.entry.content_html_sanitized).not.toContain('<script');
    expect(payload.entry.content_hash).toBe(entryContentHash({
      title: payload.entry.title,
      content_text: payload.entry.content_text,
      content_html_sanitized: payload.entry.content_html_sanitized
    }));
    expect(db.entries[0].content_html_raw).toBeNull();
  });

  it('refreshes the parent feed for full RSS content before scraping the article page', async () => {
    const db = seededDb();
    db.entries[0].stable_external_id = 'full-feed-body';
    db.entries[0].summary_text = 'Short teaser only.';
    db.entries[0].content_text = 'Short teaser only.';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://example.com/feed.xml');
      return new Response(`<?xml version="1.0"?>
        <rss xmlns:content="http://purl.org/rss/1.0/modules/content/">
          <channel><title>Full RSS</title><item>
            <title>Full feed body</title>
            <guid>full-feed-body</guid>
            <link>https://example.com/entry-1</link>
            <description><![CDATA[<p>Short teaser only.</p>]]></description>
            <content:encoded><![CDATA[<p>${'Full article from feed. '.repeat(50)}</p>]]></content:encoded>
          </item></channel>
        </rss>`, { headers: { 'content-type': 'application/rss+xml' } });
    });
    vi.stubGlobal('fetch', fetcher);

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', {
      method: 'POST'
    }), envFor(db), () => 5000);
    const payload = await response!.json() as { ok: true; entry: Entry };

    expect(response?.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.entry.content_text).toContain('Full article from feed.');
    expect(payload.entry.content_html_sanitized).toContain('<p>Full article from feed.');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the external Reader fallback when feed refresh and local extraction do not resolve content', async () => {
    const db = seededDb();
    db.entries[0].stable_external_id = 'reader-fallback';
    db.entries[0].summary_text = 'Short teaser only.';
    db.entries[0].content_text = 'Short teaser only.';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === 'https://example.com/feed.xml') {
        return new Response(`<?xml version="1.0"?>
          <rss><channel><title>Fallback RSS</title><item>
            <title>Quiet defaults</title>
            <guid>reader-fallback</guid>
            <link>https://example.com/entry-1</link>
            <description><![CDATA[<p>Short teaser only.</p>]]></description>
          </item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
      }
      if (target === 'https://example.com/entry-1') {
        return new Response('blocked', { status: 403 });
      }
      if (target === 'https://r.jina.ai/') {
        return new Response(JSON.stringify({
          title: 'Quiet defaults',
          content: `${'Full article from Reader fallback. '.repeat(40)}`
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetcher);

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', {
      method: 'POST'
    }), envFor(db), () => 5000);
    const payload = await response!.json() as { ok: true; entry: Entry };

    expect(response?.status).toBe(200);
    expect(payload.entry.content_text).toContain('Full article from Reader fallback.');
    expect(payload.entry.content_html_sanitized).toContain('<p>Full article from Reader fallback.');
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      'https://example.com/feed.xml',
      'https://example.com/entry-1',
      'https://r.jina.ai/'
    ]);
  });

  it('rejects extraction when the entry has no original article URL', async () => {
    const db = seededDb();
    db.entries[0].canonical_url = null;
    vi.stubGlobal('fetch', vi.fn());

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/extract', {
      method: 'POST'
    }), envFor(db), () => 5000);

    await expect(response?.json()).resolves.toEqual({
      ok: false,
      code: 'missing_article_url',
      message: 'This entry does not have an original article URL.'
    });
    expect(response?.status).toBe(422);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not extract entries outside the signed-in user subscriptions', async () => {
    const db = seededDb();
    db.feeds.push(feed({ id: 'feed-2', canonical_feed_url: 'https://elsewhere.example/feed.xml' }));
    db.entries.push(entry({ id: 'entry-2', feed_id: 'feed-2', stable_external_id: 'entry-2' }));
    vi.stubGlobal('fetch', vi.fn());

    const response = await handleEntriesRoute(await authed('/api/entries/entry-2/extract', {
      method: 'POST'
    }), envFor(db), () => 5000);

    await expect(response?.json()).resolves.toMatchObject({ ok: false, code: 'entry_not_found' });
    expect(response?.status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('applies read and save final state without coupling saved to read', async () => {
    const db = seededDb();

    const saveRead = await handleEntriesRoute(await authed('/api/entries/entry-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true, saved: true, updated_at_client: 100 })
    }), envFor(db), () => 1000);
    await expect(saveRead?.json()).resolves.toMatchObject({ ok: true, state: { read_at: 1000, saved_at: 1000, archived_at: null } });

    const markUnread = await handleEntriesRoute(await authed('/api/entries/entry-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: false, updated_at_client: 1100 })
    }), envFor(db), () => 1100);

    await expect(markUnread?.json()).resolves.toMatchObject({ ok: true, state: { read_at: null, saved_at: 1000, archived_at: null } });
  });

  it('archives entries so they disappear from Today', async () => {
    const db = seededDb();
    await handleEntriesRoute(await authed('/api/entries/entry-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true, updated_at_client: 100 })
    }), envFor(db), () => 1000);

    const today = await handleEntriesRoute(await authed('/api/entries'), envFor(db), () => 1200);
    await expect(today?.json()).resolves.toEqual({ ok: true, entries: [] });
  });

  it('ignores stale state mutations by updated_at_client', async () => {
    const db = seededDb();
    db.entryStates.push(state({ saved_at: 2000, updated_at: 2000 }));

    const response = await handleEntriesRoute(await authed('/api/entries/entry-1/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ saved: false, updated_at_client: 1500 })
    }), envFor(db), () => 3000);

    await expect(response?.json()).resolves.toMatchObject({ ok: true, state: { saved_at: 2000, updated_at: 2000 } });
  });

  it('returns entry detail and local server search results for subscribed feeds', async () => {
    const db = seededDb();
    db.entries.push(entry({ id: 'entry-2', stable_external_id: 'entry-2', title: 'Other note', content_text: 'Nothing here', published_at: 90 }));

    const detail = await handleEntriesRoute(await authed('/api/entries/entry-1'), envFor(db), () => 1000);
    await expect(detail?.json()).resolves.toMatchObject({ ok: true, entry: { id: 'entry-1', source_title: 'Old feed title' } });

    const search = await handleEntriesRoute(await authed('/api/search?q=local%20reading'), envFor(db), () => 1000);
    const payload = await search!.json() as { ok: true; entries: Array<{ id: string }> };
    expect(payload.entries.map((result) => result.id)).toEqual(['entry-1']);
  });

  it('returns clean preview text from search when old D1 rows contain raw markup', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ title: 'Techmeme' }));
    db.subscriptions.push(subscription());
    db.entries.push(entry({
      id: 'raw-search',
      stable_external_id: 'raw-search',
      title: 'Palantir Slack logs and staff interviews',
      summary_text: '<P><A HREF="http://www.techmeme.com/260426/p8#a260426p8" TITLE="Techmeme permalink"><IMG WIDTH=11 HEIGHT=12 SRC="http://www.techmeme.com/img/pml.png"></A> Makena Kelly / <A HREF="http://arstechnica.com/">Ars Technica</A>:<BR> <SPAN STYLE="font-size:1.3em;"><B><A HREF="https://arstechnica.com/tech-policy/2026/04/palantir-employees-are-talking-about-companys-descent-into-fascism/">Palantir Slack logs and staff interviews reveal internal debates</A></B></SPAN>&nbsp; &mdash;&nbsp; It took just a few months for employees to question the company commitments to civil liberties.</P>',
      content_text: '<p>Search body with <strong>markup</strong>.</p>'
    }));

    const search = await handleEntriesRoute(await authed('/api/search?q=civil%20liberties'), envFor(db), () => 1000);
    const payload = await search!.json() as { ok: true; entries: Array<{ summary_text: string | null; content_text: string | null }> };

    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].summary_text).not.toMatch(/[<>]|href=|IMG/i);
    expect(payload.entries[0].summary_text).toContain('It took just a few months');
    expect(payload.entries[0].content_text).toBe('Search body with markup.');
  });

  it('searches source and title terms by token relevance instead of raw substring noise', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ id: 'om-feed', title: 'On my Om', canonical_feed_url: 'https://om.co/feed.xml' }));
    db.feeds.push(feed({ id: 'tech-feed', title: 'Techmeme', canonical_feed_url: 'https://techmeme.com/feed.xml' }));
    db.subscriptions.push(subscription({ id: 'om-sub', feed_id: 'om-feed' }));
    db.subscriptions.push(subscription({ id: 'tech-sub', feed_id: 'tech-feed' }));
    db.entries.push(entry({ id: 'om-entry', feed_id: 'om-feed', stable_external_id: 'om-entry', title: 'Memory Is the Machine', summary_text: 'A sharp On my Om dispatch.', published_at: 100 }));
    db.entries.push(entry({ id: 'tech-entry', feed_id: 'tech-feed', stable_external_id: 'tech-entry', title: 'Tech industry funding notes', summary_text: '<A HREF="https://techmeme.com/story">company coverage</A> my archive', content_text: 'company coverage my archive', published_at: 200 }));

    const search = await handleEntriesRoute(await authed('/api/search?q=Om%20my%20Om'), envFor(db), () => 1000);
    const payload = await search!.json() as { ok: true; entries: Array<{ id: string }> };

    expect(payload.entries.map((result) => result.id)).toEqual(['om-entry']);
  });

});
