import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleEntriesRoute } from '../../src/worker/routes/entries';
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
