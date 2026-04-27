import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import type { Entry, EntryUserState, Feed, Subscription } from '../../src/shared/types';
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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

async function click(selector: string) {
  const target = container?.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  await act(async () => target!.click());
}

function input(selector: string, value: string) {
  const target = container?.querySelector<HTMLInputElement>(selector);
  expect(target).not.toBeNull();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(target, value);
    target!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function feed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 'feed-1', canonical_feed_url: 'https://example.com/feed.xml', site_url: 'https://example.com/', discovered_from_url: null, feed_type: 'rss', title: 'Notebook Letters', description: null, language: null, etag: null, last_modified: null, icon_url: null, updated_at: 1, created_at: 1, ...overrides
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return { id: 'sub-1', user_id: 'user-1', feed_id: 'feed-1', folder: null, sort_order: 0, is_archived: 0, created_at: 1, updated_at: 1, ...overrides };
}

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id, feed_id: 'feed-1', stable_external_id: id, canonical_url: `https://example.com/${id}`, title: `Entry ${id}`, author: 'Ada', published_at: 100, updated_at_feed: null, summary_text: 'Local cache summary', content_text: 'A body about quiet reading instruments.', content_html_sanitized: null, content_html_raw: null, has_remote_images: 0, content_hash: null, created_at: 1, updated_at: 1, ...overrides
  };
}

function state(entryId: string, overrides: Partial<EntryUserState> = {}): EntryUserState {
  return { user_id: 'user-1', entry_id: entryId, read_at: null, saved_at: null, archived_at: null, last_opened_at: null, updated_at: 1, ...overrides };
}

async function storeWith(...entries: Entry[]) {
  const store = new MemoryStore();
  await store.put('feeds', feed());
  await store.put('subscriptions', subscription());
  for (const cachedEntry of entries) {
    await store.put('entries', cachedEntry);
    await store.put('entryState', state(cachedEntry.id));
  }
  await store.put('appMeta', { key: 'syncCursor', value: 1, updated_at: 1 });
  await store.put('appMeta', { key: 'userId', value: 'user-1', updated_at: 1 });
  return store;
}

const quietApi = {
  bootstrap: async () => ({ user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 }, feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 1, syncCursor: 1 }),
  syncSince: async () => ({ feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 2, syncCursor: 2 }),
  patchEntryState: async (entryId: string) => state(entryId)
};

describe('Sources, Search, and image loading', () => {
  it('renders live source rows instead of sample sources', async () => {
    await render(<App initialUnlocked localStore={await storeWith(entry('entry-1'))} syncApi={quietApi} />);

    await click('button[aria-label="Sources"]');

    expect(container!.textContent).toContain('Notebook Letters');
    expect(container!.textContent).toContain('https://example.com/feed.xml');
    expect(container!.textContent).not.toContain('Daring Fireball');
  });

  it('searches locally cached entries without a network request', async () => {
    await render(<App initialUnlocked localStore={await storeWith(entry('match', { title: 'Quiet instrument' }), entry('miss', { title: 'No match', content_text: 'Other text' }))} syncApi={quietApi} />);

    await click('button[aria-label="Search"]');
    input('input[aria-label="Search entries"]', 'instrument');

    expect(container!.textContent).toContain('Quiet instrument');
    expect(container!.textContent).not.toContain('No match');
  });

  it('ranks source-title matches above raw body noise for multi-word searches', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed({ id: 'om-feed', title: 'On my Om', canonical_feed_url: 'https://om.co/feed.xml' }));
    await store.put('feeds', feed({ id: 'tech-feed', title: 'Techmeme', canonical_feed_url: 'https://techmeme.com/feed.xml' }));
    await store.put('subscriptions', subscription({ id: 'om-sub', feed_id: 'om-feed' }));
    await store.put('subscriptions', subscription({ id: 'tech-sub', feed_id: 'tech-feed' }));
    await store.put('entries', entry('om-entry', {
      feed_id: 'om-feed',
      title: 'Memory Is the Machine',
      summary_text: 'A sharp On my Om dispatch about memory and machines.',
      published_at: 100
    }));
    await store.put('entries', entry('tech-entry', {
      feed_id: 'tech-feed',
      title: 'Tech industry funding notes',
      summary_text: '<A HREF="https://techmeme.com/story"><IMG SRC="http://techmeme.com/i.jpg"></A> My notes from company coverage and dot com links.',
      content_text: '<A HREF="https://techmeme.com/story">company coverage</A> my archive',
      published_at: 200
    }));
    await store.put('entryState', state('om-entry'));
    await store.put('entryState', state('tech-entry'));
    await store.put('appMeta', { key: 'syncCursor', value: 1, updated_at: 1 });
    await store.put('appMeta', { key: 'userId', value: 'user-1', updated_at: 1 });

    await render(<App initialUnlocked localStore={store} syncApi={quietApi} />);
    await click('button[aria-label="Search"]');
    input('input[aria-label="Search entries"]', 'Om my Om');

    const results = [...container!.querySelectorAll('.search-result strong')].map((node) => node.textContent);
    expect(results).toEqual(['Memory Is the Machine']);
    expect(container!.textContent).not.toContain('Tech industry funding notes');
  });

  it('renders compact plain-text previews in search results', async () => {
    await render(<App initialUnlocked localStore={await storeWith(entry('html-preview', {
      title: 'Raw HTML preview',
      summary_text: '<p>Dear followers, <a href="https://example.com">start here</a>.</p><p>Second sentence.</p>'.repeat(8)
    }))} syncApi={quietApi} />);

    await click('button[aria-label="Search"]');
    input('input[aria-label="Search entries"]', 'followers');

    const preview = container!.querySelector('.search-result small');
    expect(preview?.textContent).toContain('Dear followers, start here.');
    expect(preview?.textContent).not.toContain('<p>');
    expect(preview?.textContent).not.toContain('href=');
    expect(preview!.textContent!.length).toBeLessThanOrEqual(181);
  });

  it('loads remote images only through the authenticated image proxy', async () => {
    await render(<App initialUnlocked localStore={await storeWith(entry('image-entry', {
      title: 'Proxy images',
      content_html_sanitized: '<p>Safe paragraph.</p><img src="https://tracker.example/pixel.png" alt="Tracking pixel">',
      has_remote_images: 1
    }))} syncApi={quietApi} />);

    await click('[data-entry-id="image-entry"] .entry-open-button');
    expect(container!.querySelectorAll('img[src^="http"]')).toHaveLength(0);

    await click('[data-action="load-entry-images"]');
    const image = container!.querySelector<HTMLImageElement>('.reader-body img');

    expect(image?.getAttribute('src')).toBe('/api/image?entry_id=image-entry&src=https%3A%2F%2Ftracker.example%2Fpixel.png');
    expect(container!.querySelectorAll('img[src^="http"]')).toHaveLength(0);
  });

  it('shows source refresh feedback and refreshes local state afterward', async () => {
    let resolveRefresh: (() => void) | null = null;
    const refreshPromise = new Promise<void>((resolve) => { resolveRefresh = resolve; });
    const api = {
      ...quietApi,
      bootstrap: async () => ({
        user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
        feeds: [feed({ updated_at: 3_600_000 })],
        subscriptions: [subscription()],
        entries: [],
        entryState: [],
        serverTime: 3_600_000,
        syncCursor: 3_600_000
      })
    };
    vi.stubGlobal('fetch', vi.fn(async () => {
      await refreshPromise;
      return new Response(JSON.stringify({ ok: true, refreshed: 1 }), { headers: { 'content-type': 'application/json' } });
    }));

    await render(<App initialUnlocked localStore={await storeWith(entry('entry-1'))} syncApi={api} />);
    await click('button[aria-label="Sources"]');
    await click('button[aria-label="Refresh Notebook Letters"]');

    expect(container!.querySelector('[data-subscription-id="sub-1"]')?.getAttribute('data-state')).toBe('refreshing');
    expect(container!.textContent).toContain('Refreshing...');

    await act(async () => {
      resolveRefresh?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.querySelector('[data-subscription-id="sub-1"]')?.getAttribute('data-state')).toBe('active');
  });

});
