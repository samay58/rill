import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import type { RillSyncApi } from '../../src/client/sync';
import type { Entry, EntryStatePatch, EntryUserState, Feed, Subscription, UnixMs } from '../../src/shared/types';
import { MemoryStore } from './memoryStore';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(element: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(element);
  });
  return container;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(selector: string) {
  const target = container?.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  await act(async () => target!.click());
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function feed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 'feed-1',
    canonical_feed_url: 'https://example.com/feed.xml',
    site_url: 'https://example.com/',
    discovered_from_url: null,
    feed_type: 'rss',
    title: 'Notebook Letters',
    description: null,
    language: null,
    etag: null,
    last_modified: null,
    icon_url: null,
    updated_at: 1,
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
    published_at: 100,
    updated_at_feed: null,
    summary_text: 'Cached summary',
    content_text: 'Cached body',
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
    bootstrap: async () => ({ user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 }, feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 100, syncCursor: 100 }),
    syncSince: async (_cursor: UnixMs) => ({ feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 200, syncCursor: 200 }),
    patchEntryState: async (entryId: string, patch: EntryStatePatch) => state(entryId, { read_at: patch.read ? patch.updated_at_client : null, saved_at: patch.saved ? patch.updated_at_client : null, archived_at: patch.archived ? patch.updated_at_client : null, updated_at: patch.updated_at_client }),
    ...overrides
  };
}

describe('App local-first sync wiring', () => {
  it('renders cached entries before server bootstrap completes', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.put('subscriptions', subscription());
    await store.put('entries', entry('cached', { title: 'Cached before network' }));
    await store.put('entryState', state('cached'));
    await store.put('appMeta', { key: 'syncCursor', value: 0, updated_at: 0 });

    await render(<App initialUnlocked localStore={store} syncApi={api({ bootstrap: () => new Promise(() => undefined) })} />);
    await flush();

    expect(container!.textContent).toContain('Cached before network');
  });

  it('queues Reader state actions locally and replays them through the sync API', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.put('subscriptions', subscription());
    await store.put('entries', entry('entry-1', { title: 'Replay state' }));
    await store.put('entryState', state('entry-1'));
    await store.put('appMeta', { key: 'syncCursor', value: 1, updated_at: 1 });
    const patches: EntryStatePatch[] = [];

    await render(<App initialUnlocked localStore={store} syncApi={api({
      syncSince: async () => ({ feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 2, syncCursor: 2 }),
      patchEntryState: async (entryId, patch) => {
        patches.push(patch);
        return state(entryId, { read_at: patch.read ? patch.updated_at_client : null, saved_at: patch.saved ? patch.updated_at_client : null, archived_at: patch.archived ? patch.updated_at_client : null, updated_at: patch.updated_at_client });
      }
    })} clock={() => 5000} />);
    await flush();

    await click('[data-entry-id="entry-1"] .entry-open-button');
    await click('[data-action="save-entry"]');
    await flush();

    expect(patches.some((patch) => patch.read === true)).toBe(true);
    expect(patches.some((patch) => patch.saved === true)).toBe(true);
    expect(await store.getAll('pendingMutations')).toEqual([]);
    expect(container!.querySelector('[data-action="save-entry"]')?.textContent).toBe('Saved');
  });
});
