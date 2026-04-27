import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleSubscriptionsRoute } from '../../src/worker/routes/subscriptions';
import type { Env } from '../../src/worker/env';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

function envFor(db: FakeRillD1): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

async function authed(path: string, init: RequestInit = {}): Promise<Request> {
  const cookie = await createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
  return new Request(`https://rill.local${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie } });
}

describe('subscription management routes', () => {
  it('archives and unarchives a subscription by final state', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed());
    db.subscriptions.push(subscription());

    const archive = await handleSubscriptionsRoute(await authed('/api/subscriptions/sub-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_archived: 1 })
    }), envFor(db), () => 1000);
    await expect(archive?.json()).resolves.toMatchObject({ ok: true, subscription: { id: 'sub-1', is_archived: 1, updated_at: 1000 } });

    const unarchive = await handleSubscriptionsRoute(await authed('/api/subscriptions/sub-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_archived: 0 })
    }), envFor(db), () => 1100);
    await expect(unarchive?.json()).resolves.toMatchObject({ ok: true, subscription: { id: 'sub-1', is_archived: 0, updated_at: 1100 } });
  });

  it('removes a subscription without deleting the feed row', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed());
    db.subscriptions.push(subscription());

    const response = await handleSubscriptionsRoute(await authed('/api/subscriptions/sub-1', { method: 'DELETE' }), envFor(db), () => 1000);

    await expect(response?.json()).resolves.toEqual({ ok: true, removed: true });
    expect(db.subscriptions).toEqual([]);
    expect(db.feeds).toHaveLength(1);
  });
});
