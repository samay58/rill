import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleSubscriptionsRoute } from '../../src/worker/routes/subscriptions';
import type { Env } from '../../src/worker/env';
import type { Entry, EntryUserState } from '../../src/shared/types';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

function envFor(db: FakeRillD1): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

async function authed(path: string): Promise<Request> {
  const cookie = await createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
  return new Request(`https://rill.local${path}`, { headers: { cookie } });
}

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    feed_id: 'feed-1',
    stable_external_id: id,
    canonical_url: `https://example.com/${id}`,
    title: `Entry ${id}`,
    author: null,
    published_at: 100,
    updated_at_feed: null,
    summary_text: null,
    content_text: null,
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

function state(entryId: string, overrides: Partial<EntryUserState> = {}): EntryUserState {
  return {
    user_id: 'user-1',
    entry_id: entryId,
    read_at: null,
    saved_at: null,
    archived_at: null,
    last_opened_at: null,
    updated_at: 1,
    ...overrides
  };
}

describe('bootstrap and sync routes', () => {
  it('returns a JSON auth failure when bootstrap has no valid session', async () => {
    const response = await handleSubscriptionsRoute(new Request('https://rill.local/api/bootstrap'), envFor(new FakeRillD1()), () => 1000);
    const payload = await response!.json() as { ok: false; code: string; message: string };

    expect(response?.status).toBe(401);
    expect(payload).toEqual({ ok: false, code: 'unauthorized', message: 'Unauthorized' });
  });

  it('returns real subscribed feeds, entries, and state on bootstrap', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ title: 'Notebook Letters', updated_at: 10 }));
    db.subscriptions.push(subscription({ updated_at: 11 }));
    db.entries.push(entry('entry-1', { title: 'Quiet entry', updated_at: 12 }));
    db.entryStates.push(state('entry-1', { saved_at: 13, updated_at: 13 }));

    const response = await handleSubscriptionsRoute(await authed('/api/bootstrap'), envFor(db), () => 1000);
    const payload = await response!.json() as { feeds: unknown[]; subscriptions: unknown[]; entries: Array<{ title: string }>; entryState: Array<{ saved_at: number }>; syncCursor: number };

    expect(payload.feeds).toHaveLength(1);
    expect(payload.subscriptions).toHaveLength(1);
    expect(payload.entries.map((result) => result.title)).toEqual(['Quiet entry']);
    expect(payload.entryState[0].saved_at).toBe(13);
    expect(payload.syncCursor).toBe(1000);
  });

  it('returns only rows changed after the sync cursor', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ id: 'feed-1', updated_at: 10 }), feed({ id: 'feed-2', canonical_feed_url: 'https://example.com/2.xml', updated_at: 65 }));
    db.subscriptions.push(subscription({ feed_id: 'feed-1', updated_at: 12 }), subscription({ id: 'sub-2', feed_id: 'feed-2', updated_at: 60 }));
    db.entries.push(entry('old', { updated_at: 20 }), entry('new', { feed_id: 'feed-2', updated_at: 70 }));
    db.entryStates.push(state('old', { updated_at: 25 }), state('new', { entry_id: 'new', updated_at: 80 }));

    const response = await handleSubscriptionsRoute(await authed('/api/sync?since=55'), envFor(db), () => 2000);
    const payload = await response!.json() as { feeds: Array<{ id: string }>; subscriptions: Array<{ id: string }>; entries: Array<{ id: string }>; entryState: Array<{ entry_id: string }> };

    expect(payload.feeds.map((row) => row.id)).toEqual(['feed-2']);
    expect(payload.subscriptions.map((row) => row.id)).toEqual(['sub-2']);
    expect(payload.entries.map((row) => row.id)).toEqual(['new']);
    expect(payload.entryState.map((row) => row.entry_id)).toEqual(['new']);
  });
});
