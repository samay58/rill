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
  vi.unstubAllGlobals();
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
  it('uses an existing session on refresh instead of showing unlock first', async () => {
    const store = new MemoryStore();
    await store.put('appMeta', { key: 'syncCursor', value: 0, updated_at: 0 });

    await render(<App localStore={store} syncApi={api({
      bootstrap: async () => ({
        user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
        feeds: [feed()],
        subscriptions: [subscription()],
        entries: [entry('session-entry', { title: 'Still unlocked after refresh' })],
        entryState: [state('session-entry')],
        serverTime: 100,
        syncCursor: 100
      })
    })} />);
    await flush();
    await flush();

    expect(container!.textContent).toContain('Still unlocked after refresh');
    expect(container!.querySelector('.unlock-card')).toBeNull();
  });

  it('requires unlock when the cached session has expired', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.put('subscriptions', subscription());
    await store.put('entries', entry('stale-session-entry', { title: 'Private cached entry' }));
    await store.put('entryState', state('stale-session-entry'));
    await store.put('appMeta', { key: 'syncCursor', value: 1, updated_at: 1 });
    await store.put('appMeta', { key: 'userId', value: 'user-1', updated_at: 1 });

    const expired = Object.assign(new Error('Unauthorized'), { status: 401 });
    await render(<App localStore={store} syncApi={api({ bootstrap: async () => { throw expired; } })} />);
    await flush();
    await flush();

    expect(container!.querySelector('.unlock-card')).not.toBeNull();
    expect(container!.textContent).not.toContain('Private cached entry');
  });

  it('reloads the authoritative server snapshot immediately after manual unlock', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed({ title: 'Old local feed' }));
    await store.put('subscriptions', subscription());
    await store.put('entries', entry('stale-local', { title: 'Stale local entry' }));
    await store.put('entryState', state('stale-local'));
    await store.put('appMeta', { key: 'syncCursor', value: 5, updated_at: 5 });
    await store.put('appMeta', { key: 'userId', value: 'user-1', updated_at: 5 });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, user: { id: 'user-1', handle: 'samay' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })));

    let bootstrapCalls = 0;
    await render(<App localStore={store} syncApi={api({
      bootstrap: async () => {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) throw Object.assign(new Error('Unauthorized'), { status: 401 });
        return {
          user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
          feeds: [feed({ title: 'Server feed' })],
          subscriptions: [subscription()],
          entries: [entry('server-entry', { title: 'Fresh server entry' })],
          entryState: [state('server-entry')],
          serverTime: 200,
          syncCursor: 200
        };
      },
      syncSince: async () => { throw new Error('manual unlock must not use incremental sync first'); }
    })} />);
    await flush();
    await flush();

    const input = container!.querySelector<HTMLInputElement>('#token');
    expect(input).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'private-token');
      input!.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'private-token', inputType: 'insertText' }));
    });
    await click('.accent-button');
    await flush();
    await flush();

    expect(container!.textContent).toContain('Fresh server entry');
    expect(container!.textContent).not.toContain('Stale local entry');
    expect(await store.get<Entry>('entries', 'stale-local')).toBeUndefined();
  });

  it('saves from Reader with clear feedback and immediately appears in Saved', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.put('subscriptions', subscription());
    await store.put('entries', entry('save-me', { title: 'Save this clearly' }));
    await store.put('entryState', state('save-me'));
    await store.put('appMeta', { key: 'syncCursor', value: 1, updated_at: 1 });
    await store.put('appMeta', { key: 'userId', value: 'user-1', updated_at: 1 });

    await render(<App initialUnlocked localStore={store} syncApi={api({
      syncSince: async () => ({ feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 2, syncCursor: 2 }),
      patchEntryState: async (entryId, patch) => state(entryId, { saved_at: patch.saved ? patch.updated_at_client : null, updated_at: patch.updated_at_client })
    })} clock={() => 5000} />);
    await flush();

    await click('[data-entry-id="save-me"] .entry-open-button');
    expect(container!.querySelector('[data-action="save-entry"]')?.textContent).toBe('Save for later');
    await click('[data-action="save-entry"]');
    await flush();

    expect(container!.querySelector('[data-action="save-entry"]')?.textContent).toBe('Saved');
    expect(container!.textContent).toContain('Saved to Saved');

    await click('button[aria-label="Saved"]');
    expect(container!.textContent).toContain('Save this clearly');
  });

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
