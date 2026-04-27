import { describe, expect, it } from 'vitest';
import type { Entry, EntryUserState, Feed, Subscription, UnixMs } from '../../src/shared/types';
import type { PendingEntryMutation } from '../../src/client/db';
import { RILL_STORE_NAMES } from '../../src/client/db';
import { MemoryStore } from './memoryStore';
import {
  bootstrapFromServer,
  loadCachedState,
  queueEntryStateMutation,
  replayPendingMutations,
  syncSince,
  type RillSyncApi
} from '../../src/client/sync';

function feed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 'feed-1',
    canonical_feed_url: 'https://example.com/feed.xml',
    site_url: 'https://example.com/',
    discovered_from_url: null,
    feed_type: 'rss',
    title: 'Example Feed',
    description: null,
    language: null,
    etag: null,
    last_modified: null,
    icon_url: null,
    updated_at: 10,
    created_at: 1,
    ...overrides
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    feed_id: 'feed-1',
    folder: null,
    sort_order: 0,
    is_archived: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    feed_id: 'feed-1',
    stable_external_id: id,
    canonical_url: `https://example.com/${id}`,
    title: `Entry ${id}`,
    author: null,
    published_at: 10,
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

function api(overrides: Partial<RillSyncApi> = {}): RillSyncApi {
  return {
    bootstrap: async () => ({
      user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
      feeds: [],
      subscriptions: [],
      entries: [],
      entryState: [],
      serverTime: 100,
      syncCursor: 100
    }),
    syncSince: async (_cursor: UnixMs) => ({ feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 200, syncCursor: 200 }),
    patchEntryState: async (_entryId, patch) => state(_entryId, { read_at: patch.read ? patch.updated_at_client : null, updated_at: patch.updated_at_client }),
    ...overrides
  };
}

describe('local-first sync', () => {
  it('declares every required IndexedDB store', () => {
    expect(RILL_STORE_NAMES).toEqual(['subscriptions', 'feeds', 'entries', 'entryState', 'pendingMutations', 'appMeta', 'searchIndexMeta']);
  });

  it('loads cached records before any network bootstrap', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.put('subscriptions', subscription());
    await store.put('entries', entry('entry-cached', { title: 'Cached entry' }));
    await store.put('entryState', state('entry-cached', { saved_at: 50, updated_at: 50 }));
    await store.put('appMeta', { key: 'syncCursor', value: 75, updated_at: 75 });

    const cached = await loadCachedState(store);

    expect(cached.entries.map((cachedEntry) => cachedEntry.title)).toEqual(['Cached entry']);
    expect(cached.entryState[0].saved_at).toBe(50);
    expect(cached.syncCursor).toBe(75);
  });

  it('repairs cached entry summary and body text that still contain markup', async () => {
    const store = new MemoryStore();
    await store.put('entries', entry('raw-cached', {
      summary_text: '<p>Dear reader, <a href="https://example.com">start here</a>.</p>',
      content_text: '<p>Cached body with <strong>markup</strong>.</p>'
    }));

    const cached = await loadCachedState(store);
    const stored = await store.get<Entry>('entries', 'raw-cached');

    expect(cached.entries[0].summary_text).toBe('Dear reader, start here.');
    expect(cached.entries[0].content_text).toBe('Cached body with markup.');
    expect(stored?.summary_text).toBe('Dear reader, start here.');
    expect(stored?.content_text).toBe('Cached body with markup.');
  });

  it('treats bootstrap as the authoritative server snapshot and drops orphan pending mutations', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed({ id: 'old-feed', title: 'Old Feed' }));
    await store.put('subscriptions', subscription({ id: 'old-sub', feed_id: 'old-feed' }));
    await store.put('entries', entry('stale-entry', { feed_id: 'old-feed', title: 'Stale raw entry' }));
    await store.put('entryState', state('stale-entry', { read_at: 50, updated_at: 50 }));
    await store.put<PendingEntryMutation>('pendingMutations', { entry_id: 'stale-entry', read: true, updated_at_client: 80, queued_at: 80, attempts: 1 });
    await store.put<PendingEntryMutation>('pendingMutations', { entry_id: 'entry-server', saved: true, updated_at_client: 90, queued_at: 90, attempts: 0 });

    const cached = await bootstrapFromServer(store, api({
      bootstrap: async () => ({
        user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
        feeds: [feed()],
        subscriptions: [subscription()],
        entries: [entry('entry-server', { title: 'Server entry' })],
        entryState: [state('entry-server')],
        serverTime: 125,
        syncCursor: 125
      })
    }));

    expect(cached.feeds.map((cachedFeed) => cachedFeed.id)).toEqual(['feed-1']);
    expect(cached.subscriptions.map((cachedSubscription) => cachedSubscription.id)).toEqual(['sub-1']);
    expect(cached.entries.map((cachedEntry) => cachedEntry.id)).toEqual(['entry-server']);
    expect(cached.entryState.map((cachedState) => cachedState.entry_id)).toEqual(['entry-server']);
    expect(cached.pendingMutations.map((mutation) => mutation.entry_id)).toEqual(['entry-server']);
    expect(await store.get<Entry>('entries', 'stale-entry')).toBeUndefined();
  });

  it('bootstraps server records into the local cache without clearing valid pending mutations', async () => {
    const store = new MemoryStore();
    await store.put<PendingEntryMutation>('pendingMutations', { entry_id: 'entry-server', read: true, updated_at_client: 140, queued_at: 80, attempts: 0 });

    const cached = await bootstrapFromServer(store, api({
      bootstrap: async () => ({
        user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
        feeds: [feed()],
        subscriptions: [subscription()],
        entries: [entry('entry-server', { title: 'Server entry' })],
        entryState: [state('entry-server', { read_at: 90, updated_at: 90 })],
        serverTime: 125,
        syncCursor: 125
      })
    }));

    expect(cached.entries.map((cachedEntry) => cachedEntry.id)).toEqual(['entry-server']);
    expect(cached.pendingMutations.map((mutation) => mutation.entry_id)).toEqual(['entry-server']);
    expect(cached.entryState[0]).toMatchObject({ entry_id: 'entry-server', read_at: 140, updated_at: 140 });
    expect(cached.syncCursor).toBe(125);
  });

  it('keeps a newer pending final state when server sync returns older state', async () => {
    const store = new MemoryStore();
    await store.put('entryState', state('entry-1', { read_at: 250, updated_at: 250 }));
    await queueEntryStateMutation(store, 'user-1', 'entry-1', { read: false, updated_at_client: 300 }, () => 300);

    await syncSince(store, 100, api({
      syncSince: async () => ({
        feeds: [],
        subscriptions: [],
        entries: [],
        entryState: [state('entry-1', { read_at: 200, updated_at: 200 })],
        serverTime: 225,
        syncCursor: 225
      })
    }));

    const localState = await store.get<EntryUserState>('entryState', 'entry-1');
    expect(localState).toMatchObject({ entry_id: 'entry-1', read_at: null, updated_at: 300 });
  });

  it('coalesces final-state mutations and replays them in timestamp order', async () => {
    const store = new MemoryStore();
    const calls: Array<{ entryId: string; updated_at_client: number; saved?: boolean; archived?: boolean; read?: boolean }> = [];
    await queueEntryStateMutation(store, 'user-1', 'entry-late', { read: true, updated_at_client: 500 }, () => 500);
    await queueEntryStateMutation(store, 'user-1', 'entry-early', { archived: true, updated_at_client: 400 }, () => 400);
    await queueEntryStateMutation(store, 'user-1', 'entry-late', { saved: true, updated_at_client: 550 }, () => 550);

    const result = await replayPendingMutations(store, api({
      patchEntryState: async (entryId, patch) => {
        calls.push({ entryId, ...patch });
        return state(entryId, { saved_at: patch.saved ? patch.updated_at_client : null, archived_at: patch.archived ? patch.updated_at_client : null, read_at: patch.read ? patch.updated_at_client : null, updated_at: patch.updated_at_client });
      }
    }));

    expect(calls.map((call) => [call.entryId, call.updated_at_client])).toEqual([
      ['entry-early', 400],
      ['entry-late', 550]
    ]);
    expect(calls[1]).toMatchObject({ read: true, saved: true });
    expect(result).toEqual({ attempted: 2, applied: 2, remaining: 0 });
    expect(await store.getAll<PendingEntryMutation>('pendingMutations')).toEqual([]);
  });

  it('keeps a pending mutation when replay fails', async () => {
    const store = new MemoryStore();
    await queueEntryStateMutation(store, 'user-1', 'entry-1', { saved: true, updated_at_client: 600 }, () => 600);

    const result = await replayPendingMutations(store, api({
      patchEntryState: async () => { throw new Error('offline'); }
    }));

    expect(result).toEqual({ attempted: 1, applied: 0, remaining: 1 });
    expect(await store.get<PendingEntryMutation>('pendingMutations', 'entry-1')).toMatchObject({ entry_id: 'entry-1', saved: true, attempts: 1 });
  });
});
