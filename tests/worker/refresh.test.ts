import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { consumeRefreshMessage, enqueueDueFeeds, handleRefreshRoute } from '../../src/worker/routes/refresh';
import type { Env } from '../../src/worker/env';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

function envFor(db: FakeRillD1, queue = new FakeQueue()): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: queue as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

async function authedPost(path: string): Promise<Request> {
  const cookie = await createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
  return new Request(`https://rill.local${path}`, { method: 'POST', headers: { cookie } });
}

describe('refresh routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes all active subscriptions immediately for a manual refresh', async () => {
    const db = new FakeRillD1();
    const queue = new FakeQueue();
    db.feeds.push(feed({ id: 'feed-1', canonical_feed_url: 'https://example.com/one.xml' }));
    db.feeds.push(feed({ id: 'feed-2', canonical_feed_url: 'https://example.com/two.xml' }));
    db.subscriptions.push(subscription({ id: 'sub-active-1', feed_id: 'feed-1' }));
    db.subscriptions.push(subscription({ id: 'sub-active-2', feed_id: 'feed-2' }));
    db.subscriptions.push(subscription({ id: 'sub-archived', feed_id: 'feed-3', is_archived: 1 }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<?xml version="1.0"?><rss><channel><title>Manual</title><item><title>Manual item</title><guid>${crypto.randomUUID()}</guid></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })));

    const response = await handleRefreshRoute(await authedPost('/api/refresh'), envFor(db, queue), () => 1000);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ ok: true, queued: 0, refreshed: 2 });
    expect(queue.messages).toEqual([]);
    expect(db.entries).toHaveLength(2);
  });

  it('refreshes one active subscription by id immediately', async () => {
    const db = new FakeRillD1();
    const queue = new FakeQueue();
    db.feeds.push(feed({ id: 'feed-9', canonical_feed_url: 'https://example.com/feed-9.xml' }));
    db.subscriptions.push(subscription({ id: 'sub-target', feed_id: 'feed-9' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<?xml version="1.0"?><rss><channel><title>Manual</title><item><title>One item</title><guid>one</guid></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })));

    const response = await handleRefreshRoute(await authedPost('/api/subscriptions/sub-target/refresh'), envFor(db, queue), () => 1000);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ ok: true, queued: 0, refreshed: 1 });
    expect(queue.messages).toEqual([]);
    expect(db.entries).toHaveLength(1);
  });

  it('does not queue an archived subscription by id', async () => {
    const db = new FakeRillD1();
    const queue = new FakeQueue();
    db.subscriptions.push(subscription({ id: 'sub-archived', is_archived: 1 }));

    const response = await handleRefreshRoute(await authedPost('/api/subscriptions/sub-archived/refresh'), envFor(db, queue), () => 1000);

    expect(response?.status).toBe(404);
    expect(queue.messages).toEqual([]);
  });

  it('cron queues due feeds with active subscriptions only', async () => {
    const db = new FakeRillD1();
    const queue = new FakeQueue();
    db.subscriptions.push(subscription({ id: 'sub-due', feed_id: 'feed-due' }));
    db.subscriptions.push(subscription({ id: 'sub-future', feed_id: 'feed-future' }));
    db.subscriptions.push(subscription({ id: 'sub-archived', feed_id: 'feed-archived', is_archived: 1 }));
    db.queueStates.push({ feed_id: 'feed-due', next_poll_at: 900, last_polled_at: null, last_success_at: null, failure_count: 0 });
    db.queueStates.push({ feed_id: 'feed-future', next_poll_at: 5000, last_polled_at: null, last_success_at: null, failure_count: 0 });
    db.queueStates.push({ feed_id: 'feed-archived', next_poll_at: 800, last_polled_at: null, last_success_at: null, failure_count: 0 });

    const queued = await enqueueDueFeeds(envFor(db, queue), () => 1000);

    expect(queued).toBe(1);
    expect(queue.messages).toEqual([{ feedId: 'feed-due' }]);
  });

  it('queue messages fetch and store the feed', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ id: 'feed-from-queue', canonical_feed_url: 'https://example.com/feed.xml' }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<?xml version="1.0"?><rss><channel><title>Queued</title><item><title>Queued item</title><guid>queued-1</guid></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })));

    await consumeRefreshMessage(envFor(db), { feedId: 'feed-from-queue' });

    expect(db.fetchRuns[0]).toMatchObject({ feed_id: 'feed-from-queue', status: 'ok' });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0]).toMatchObject({ feed_id: 'feed-from-queue', stable_external_id: 'queued-1', title: 'Queued item' });
  });
});
