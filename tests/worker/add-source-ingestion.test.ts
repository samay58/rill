import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleSubscriptionsRoute } from '../../src/worker/routes/subscriptions';
import type { Env } from '../../src/worker/env';
import { FakeQueue, FakeRillD1 } from './fakeRillD1';

function envFor(db: FakeRillD1): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

async function authed(body: unknown): Promise<Request> {
  const cookie = await createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
  return new Request('https://rill.local/api/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body)
  });
}

describe('add source ingestion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stores initial feed entries when a direct feed is subscribed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<?xml version="1.0"?><rss><channel><title>Fresh Feed</title><item><title>First item</title><guid>first</guid></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })));
    const db = new FakeRillD1();

    const response = await handleSubscriptionsRoute(await authed({ url: 'https://example.com/feed.xml' }), envFor(db), () => 1000);

    await expect(response?.json()).resolves.toMatchObject({ ok: true, kind: 'created', subscription: { title: 'Fresh Feed' } });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0]).toMatchObject({ title: 'First item', stable_external_id: 'first' });
  });
});
