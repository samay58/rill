import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndStoreFeed } from '../../src/worker/feedFetch';
import type { Env } from '../../src/worker/env';
import { FakeQueue, FakeRillD1, feed } from './fakeRillD1';

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

describe('fetchAndStoreFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends conditional headers, stores a 200 response, and records fetch metadata', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ etag: '"old-etag"', last_modified: 'Mon, 27 Apr 2026 09:00:00 GMT' }));
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('if-none-match')).toBe('"old-etag"');
      expect(headers.get('if-modified-since')).toBe('Mon, 27 Apr 2026 09:00:00 GMT');
      return new Response(fixture('rss-guid.xml'), {
        headers: {
          'content-type': 'application/rss+xml',
          etag: '"new-etag"',
          'last-modified': 'Mon, 27 Apr 2026 12:30:00 GMT'
        }
      });
    });

    const result = await fetchAndStoreFeed(envFor(db), 'feed-1', { fetcher, clock: () => 1000 });

    expect(result).toEqual({ status: 'ok', entriesUpserted: 2, httpStatus: 200 });
    expect(fetcher).toHaveBeenCalledWith('https://example.com/feed.xml', expect.any(Object));
    expect(db.feeds[0]).toMatchObject({ title: 'Guid Feed', etag: '"new-etag"', last_modified: 'Mon, 27 Apr 2026 12:30:00 GMT' });
    expect(db.entries.map((entry) => [entry.id, entry.title])).toEqual([
      ['entry:feed-1:guid-post-1', 'First guided post'],
      ['entry:feed-1:guid-post-2', 'Second guided post']
    ]);
    expect(db.entries[0].content_html_sanitized).toContain('<strong>reader</strong>');
    expect(db.entries[0].content_hash).toEqual(expect.any(String));
    expect(db.fetchRuns).toHaveLength(1);
    expect(db.fetchRuns[0]).toMatchObject({ feed_id: 'feed-1', status: 'ok', http_status: 200, error_code: null });
    expect(db.queueStates[0]).toMatchObject({ feed_id: 'feed-1', next_poll_at: 1_801_000, last_success_at: 1000, failure_count: 0 });
  });

  it('records 304 as not modified without touching entries', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ etag: '"same"' }));
    db.entries.push({
      id: 'entry:feed-1:existing',
      feed_id: 'feed-1',
      stable_external_id: 'existing',
      canonical_url: 'https://example.com/existing',
      title: 'Existing',
      author: null,
      published_at: null,
      updated_at_feed: null,
      summary_text: null,
      content_text: null,
      content_html_sanitized: null,
      content_html_raw: null,
      has_remote_images: 0,
      content_hash: 'old',
      created_at: 1,
      updated_at: 1
    });

    const result = await fetchAndStoreFeed(envFor(db), 'feed-1', {
      fetcher: async () => new Response(null, { status: 304 }),
      clock: () => 2000
    });

    expect(result).toEqual({ status: 'not_modified', entriesUpserted: 0, httpStatus: 304 });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].title).toBe('Existing');
    expect(db.fetchRuns[0]).toMatchObject({ status: 'not_modified', http_status: 304, bytes_received: 0 });
    expect(db.queueStates[0]).toMatchObject({ next_poll_at: 1_802_000, last_success_at: 2000, failure_count: 0 });
  });

  it('logs malformed XML as a parse error', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed());

    const result = await fetchAndStoreFeed(envFor(db), 'feed-1', {
      fetcher: async () => new Response('<rss><channel><item><title>Broken', { headers: { 'content-type': 'application/rss+xml' } }),
      clock: () => 3000
    });

    expect(result).toEqual({ status: 'parse_error', entriesUpserted: 0, httpStatus: 200 });
    expect(db.entries).toHaveLength(0);
    expect(db.fetchRuns[0]).toMatchObject({ status: 'parse_error', http_status: 200, error_code: 'parse_error' });
    expect(db.queueStates[0]).toMatchObject({ next_poll_at: 3_603_000, last_success_at: null, failure_count: 1 });
  });

  it('logs aborted fetches as timeouts', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed());

    const result = await fetchAndStoreFeed(envFor(db), 'feed-1', {
      fetcher: async () => { throw new DOMException('aborted', 'AbortError'); },
      clock: () => 4000
    });

    expect(result.status).toBe('timeout');
    expect(db.fetchRuns[0]).toMatchObject({ status: 'timeout', http_status: null, error_code: 'timeout' });
    expect(db.queueStates[0]).toMatchObject({ next_poll_at: 3_604_000, last_success_at: null, failure_count: 1 });
  });

  it('logs non-ok responses as http errors', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed());

    const result = await fetchAndStoreFeed(envFor(db), 'feed-1', {
      fetcher: async () => new Response('nope', { status: 502 }),
      clock: () => 4500
    });

    expect(result).toEqual({ status: 'http_error', entriesUpserted: 0, httpStatus: 502 });
    expect(db.entries).toHaveLength(0);
    expect(db.fetchRuns[0]).toMatchObject({ status: 'http_error', http_status: 502, error_code: 'http_error' });
    expect(db.queueStates[0]).toMatchObject({ next_poll_at: 3_604_500, last_success_at: null, failure_count: 1 });
  });

  it('upserts repeated refreshes without duplicating entries', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed());
    const fetcher = vi.fn(async () => new Response(fixture('rss-guid.xml'), { headers: { 'content-type': 'application/rss+xml' } }));

    await fetchAndStoreFeed(envFor(db), 'feed-1', { fetcher, clock: () => 5000 });
    await fetchAndStoreFeed(envFor(db), 'feed-1', { fetcher, clock: () => 6000 });

    expect(db.entries).toHaveLength(2);
    expect(db.entries.map((entry) => entry.stable_external_id)).toEqual(['guid-post-1', 'guid-post-2']);
    expect(db.fetchRuns.map((run) => run.status)).toEqual(['ok', 'ok']);
  });
});
