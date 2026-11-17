import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import type { ReadingEntry } from '../../src/client/views/TodayView';
import { TodayView } from '../../src/client/views/TodayView';
import type { EntryUserState, Feed, Subscription } from '../../src/shared/types';
import { MemoryStore } from './memoryStore';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(element);
  });
  return container;
}

function click(selector: string) {
  const target = container?.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  act(() => target!.click());
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

function entry(id: string, overrides: Partial<ReadingEntry> = {}): ReadingEntry {
  return {
    id,
    feed_id: 'feed-1',
    stable_external_id: id,
    canonical_url: `https://example.com/${id}`,
    title: `Entry ${id}`,
    author: 'Ada',
    published_at: Date.parse('2026-04-27T12:00:00Z'),
    updated_at_feed: null,
    summary_text: 'A quiet summary for the list.',
    content_text: 'First paragraph.\n\nSecond paragraph.',
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    source_title: 'Notebook Letters',
    read_at: null,
    saved_at: null,
    archived_at: null,
    last_opened_at: null,
    ...overrides
  };
}

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

function entryState(entryId: string, overrides: Partial<EntryUserState> = {}): EntryUserState {
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

describe('Today and Reader', () => {
  it('renders a finite Today list of unread unarchived entries', () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry(`entry-${index}`, { published_at: 1000 + index }));
    const host = render(<TodayView entries={entries} onOpenEntry={() => undefined} />);

    expect(host.querySelectorAll('.entry-row')).toHaveLength(25);
    expect(host.textContent).toContain('Caught up for now');
    expect(host.textContent).toContain('Entry entry-29');
    expect(host.textContent).not.toContain('Entry entry-0');
  });

  it('shows a caught-up state when no unread entries remain', () => {
    const host = render(<TodayView entries={[entry('read', { read_at: 10 }), entry('archived', { archived_at: 20 })]} onOpenEntry={() => undefined} />);

    expect(host.querySelectorAll('.entry-row')).toHaveLength(0);
    expect(host.textContent).toContain('Caught up for now');
  });

  it('opens Reader, marks the entry read, and keeps it in place on Today for the rest of the day', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('one', { title: 'The quiet loop' })]} clock={() => 1000} />);

    click('[data-entry-id="one"] .entry-open-button');
    expect(host.querySelector('.reader-article h1')?.textContent).toBe('The quiet loop');
    click('[data-action="back-to-today"]');

    expect(host.textContent).toContain('The quiet loop');
    expect(host.querySelector('[data-entry-id="one"]')?.getAttribute('data-state')).toBe('read');
    expect(host.textContent).toContain('Caught up for now');
  });

  it('drops entries read before today but keeps those read today', () => {
    const now = Date.parse('2026-11-16T15:00:00');
    const host = render(<TodayView now={now} onOpenEntry={() => undefined} entries={[
      entry('read-today', { read_at: Date.parse('2026-11-16T08:00:00') }),
      entry('read-yesterday', { read_at: Date.parse('2026-11-15T22:00:00') }),
      entry('unread')
    ]} />);

    expect(host.querySelector('[data-entry-id="read-today"]')).not.toBeNull();
    expect(host.querySelector('[data-entry-id="read-yesterday"]')).toBeNull();
    expect(host.querySelector('[data-entry-id="unread"]')).not.toBeNull();
  });

  it('pins the newest Morning Edition above newer posts, read or not, until it is two days old', () => {
    const now = Date.parse('2026-11-16T15:00:00');
    const edition = (id: string, published: string, overrides: Partial<ReadingEntry> = {}) => entry(id, {
      feed_id: 'https://rill.example/edition', source_title: 'Morning Edition', title: `Edition ${id}`, published_at: Date.parse(published), ...overrides
    });
    const entries = [
      entry('fresh', { published_at: Date.parse('2026-11-16T14:00:00') }),
      edition('mon', '2026-11-16T06:45:00', { read_at: Date.parse('2026-11-16T07:00:00') }),
      edition('sun', '2026-11-15T06:45:00')
    ];
    const host = render(<TodayView now={now} onOpenEntry={() => undefined} entries={entries} />);

    const pinned = host.querySelector('.edition-pin [data-entry-id]');
    expect(pinned?.getAttribute('data-entry-id')).toBe('mon');
    expect(pinned?.getAttribute('data-state')).toBe('read');
    expect(host.querySelectorAll('[data-entry-id="mon"]')).toHaveLength(1);

    if (root) act(() => root!.unmount());
    container?.remove();
    const stale = render(<TodayView now={Date.parse('2026-11-19T15:00:00')} onOpenEntry={() => undefined} entries={entries} />);
    expect(stale.querySelector('.edition-pin')).toBeNull();
  });

  it('gives Reader a history entry so the browser Back returns to the list', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('one', { title: 'History stays put' })]} clock={() => 1000} />);

    click('[data-entry-id="one"] .entry-open-button');
    expect(window.location.hash).toBe('#read/one');
    expect(window.history.state?.rillReader).toBe('one');

    act(() => {
      window.history.replaceState(null, '', window.location.pathname);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('.reader-article')).toBeNull();
    expect(host.querySelector('[data-entry-id="one"]')).not.toBeNull();
  });

  it('labels the back control with the view Reader was opened from', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('one', { title: 'Kept for later', saved_at: 5 })]} clock={() => 1000} />);

    click('.side-nav-item[aria-label="Saved"]');
    click('[data-entry-id="one"] .entry-open-button, .saved-list button, [data-entry-id="one"] button');
    expect(host.querySelector('[data-action="back-to-today"]')?.textContent).toContain('Saved');
    click('[data-action="back-to-today"]');
    expect(host.querySelector('.side-nav-item.is-active')?.getAttribute('aria-label')).toBe('Saved');
  });

  it('saves, marks unread, and archives from Reader with final state semantics', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('one', { title: 'Stateful reading' })]} clock={() => 2000} />);

    click('[data-entry-id="one"] .entry-open-button');
    click('[data-action="save-entry"]');
    expect(host.querySelector('[data-action="save-entry"]')?.textContent).toBe('Saved');

    click('[data-action="mark-unread"]');
    click('[data-action="back-to-today"]');
    expect(host.textContent).toContain('Stateful reading');
    expect(host.querySelector('[data-entry-id="one"] .saved-star')).not.toBeNull();

    click('[data-entry-id="one"] .entry-open-button');
    click('[data-action="archive-entry"]');
    expect(host.textContent).toContain('Caught up for now');
    expect(host.textContent).not.toContain('Stateful reading');
  });

  it('shows original-link and hidden-image controls without rendering remote images', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('image-entry', {
      title: 'Remote image discipline',
      canonical_url: 'https://example.com/original',
      content_html_sanitized: '<p>Safe paragraph.</p><img src="https://tracker.example/pixel.png" alt=""><blockquote>Quoted note.</blockquote>',
      has_remote_images: 1
    })]} />);

    click('[data-entry-id="image-entry"] .entry-open-button');

    expect(host.textContent).toContain('1 remote image hidden');
    expect(host.textContent).toContain('Load for this entry');
    expect(host.querySelector<HTMLAnchorElement>('[data-action="open-original"]')?.href).toBe('https://example.com/original');
    expect(host.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    expect(host.querySelector('.reader-body blockquote')?.textContent).toContain('Quoted note.');
  });

  it('loads public full articles from Reader while keeping Open Original visible', async () => {
    const fullText = `Full body from the publisher.\n\n${'A complete article paragraph with enough substance to replace the feed preview. '.repeat(14)}`;
    const extracted = entry('teaser', {
      title: 'Publisher original',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: fullText,
      content_html_sanitized: null,
      updated_at: 2
    });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, entry: extracted })
    }));
    vi.stubGlobal('fetch', fetch);
    const host = render(<App initialUnlocked initialEntries={[entry('teaser', {
      title: 'Publisher original',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: 'Short feed preview.'
    })]} />);

    click('[data-entry-id="teaser"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    expect(host.textContent).toContain('Full body from the publisher.');
    expect(host.querySelector('[data-action="load-full-article"]')).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>('[data-action="open-original"]')?.href).toBe('https://example.com/original');
    expect(fetch).toHaveBeenCalledWith('/api/entries/teaser/extract', {
      method: 'POST',
      credentials: 'same-origin'
    });
  });

  it('shows extraction failures while preserving teaser content and original link', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => ({ ok: false, code: 'extract_failed', message: 'Publisher blocked extraction.' })
    }));
    vi.stubGlobal('fetch', fetch);
    const host = render(<App initialUnlocked initialEntries={[entry('teaser', {
      title: 'A public preview',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: 'Teaser paragraph stays visible.'
    })]} />);

    click('[data-entry-id="teaser"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    expect(host.textContent).toContain('Publisher blocked extraction.');
    expect(host.textContent).toContain('Teaser paragraph stays visible.');
    expect(host.querySelector<HTMLAnchorElement>('[data-action="open-original"]')?.href).toBe('https://example.com/original');
  });

  it('keeps extracted remote images hidden until explicitly loaded', async () => {
    const extracted = entry('image-teaser', {
      title: 'Images from the original',
      canonical_url: 'https://example.com/original',
      content_html_sanitized: `<p>${'Full publisher copy. '.repeat(50)}</p><img src="https://cdn.example.com/photo.jpg" alt="Publisher photo">`,
      content_text: null,
      has_remote_images: 1,
      updated_at: 2
    });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, entry: extracted })
    }));
    vi.stubGlobal('fetch', fetch);
    const host = render(<App initialUnlocked initialEntries={[entry('image-teaser', {
      title: 'Images from the original',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: 'Short feed preview.'
    })]} />);

    click('[data-entry-id="image-teaser"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    expect(host.textContent).toContain('Full publisher copy.');
    expect(host.textContent).toContain('1 remote image hidden');
    expect(host.querySelectorAll('img[src^="http"]')).toHaveLength(0);

    click('[data-action="load-entry-images"]');
    expect(host.querySelector<HTMLImageElement>('.reader-body img')?.src).toContain('/api/image?entry_id=image-teaser');
  });

  it('does not render relative extracted images even after images are loaded', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('relative-image', {
      title: 'Relative media from publisher',
      content_html_sanitized: '<p>Full publisher copy.</p><img src="/why-everyone-you-know-is-playing-padel" alt="">',
      has_remote_images: 1
    })]} />);

    click('[data-entry-id="relative-image"] .entry-open-button');
    expect(host.textContent).toContain('1 remote image hidden');
    expect(host.querySelector('.reader-body img')).toBeNull();

    click('[data-action="load-entry-images"]');
    expect(host.textContent).toContain('Full publisher copy.');
    expect(host.querySelector('.reader-body img')).toBeNull();
  });

  it('preserves local reader state when extraction returns stale state fields', async () => {
    let resolveExtraction: (value: unknown) => void = () => undefined;
    const extracted = entry('stateful-teaser', {
      title: 'Extracted article',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: `${'Full article text. '.repeat(60)}`,
      read_at: null,
      saved_at: null,
      archived_at: null,
      last_opened_at: null,
      updated_at: 2
    });
    const fetch = vi.fn(() => new Promise((resolve) => { resolveExtraction = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const host = render(<App initialUnlocked initialEntries={[entry('stateful-teaser', {
      title: 'Stateful teaser',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: 'Short feed preview.',
      saved_at: null
    })]} clock={() => 5000} />);

    click('[data-entry-id="stateful-teaser"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());
    click('[data-action="save-entry"]');
    expect(host.querySelector('[data-action="save-entry"]')?.textContent).toBe('Saved');

    await act(async () => {
      resolveExtraction({
        ok: true,
        json: async () => ({ ok: true, entry: extracted })
      });
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Full article text.');
    expect(host.querySelector('[data-action="save-entry"]')?.textContent).toBe('Saved');
    click('[data-action="back-to-today"]');
    expect(host.textContent).toContain('Caught up for now');
  });

  it('stores extracted content as an entry row without user-state fields', async () => {
    const store = new MemoryStore();
    const teaser = entry('cached-teaser', {
      title: 'Cached teaser',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: 'Short feed preview.',
      read_at: null,
      saved_at: null,
      archived_at: null,
      last_opened_at: null
    });
    await store.put('feeds', feed());
    await store.put('subscriptions', subscription());
    await store.put('entries', teaser);
    await store.put('entryState', entryState('cached-teaser'));
    const extracted = entry('cached-teaser', {
      title: 'Cached full article',
      canonical_url: 'https://example.com/original',
      summary_text: 'Short feed preview.',
      content_text: `${'Full cached article. '.repeat(60)}`,
      read_at: null,
      saved_at: 123,
      archived_at: 456,
      last_opened_at: 789,
      updated_at: 2
    });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, entry: extracted })
    }));
    vi.stubGlobal('fetch', fetch);
    const host = render(<App
      initialUnlocked
      initialEntries={[teaser]}
      localStore={store}
      syncApi={{
        bootstrap: () => new Promise(() => undefined),
        syncSince: () => new Promise(() => undefined),
        patchEntryState: async () => entryState('cached-teaser')
      }}
    />);

    click('[data-entry-id="cached-teaser"] .entry-open-button');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="load-full-article"]')!.click());

    const stored = await store.get<Record<string, unknown>>('entries', 'cached-teaser');
    expect(stored?.content_text).toContain('Full cached article.');
    expect(stored).not.toHaveProperty('source_title');
    expect(stored).not.toHaveProperty('read_at');
    expect(stored).not.toHaveProperty('saved_at');
    expect(stored).not.toHaveProperty('archived_at');
    expect(stored).not.toHaveProperty('last_opened_at');
  });

  it('renders compact plain-text previews in Today', () => {
    const host = render(<TodayView entries={[entry('raw-html', {
      title: 'New Year, New Digital You',
      summary_text: '<p>Dear followers of The Opt Out Project,</p><p>Today I announce the start of <a href="https://example.com">Take Back Your Digital Footprint</a>.</p>'.repeat(8)
    })]} onOpenEntry={() => undefined} />);

    const excerpt = host.querySelector('.entry-excerpt');
    expect(excerpt?.textContent).toContain('Dear followers of The Opt Out Project');
    expect(excerpt?.textContent).not.toContain('<p>');
    expect(excerpt?.textContent).not.toContain('href=');
    expect(excerpt!.textContent!.length).toBeLessThanOrEqual(181);
  });



  it('never renders raw aggregator markup in Today previews', () => {
    const host = render(<TodayView entries={[entry('aggregator-raw', {
      title: 'Publisher announces a five-principle framework for durable development',
      source_title: 'Techmeme',
      summary_text: '<P><A HREF="http://www.techmeme.com/260426/p12#a260426p12" TITLE="Techmeme permalink"><IMG WIDTH=11 HEIGHT=12 SRC="http://www.techmeme.com/img/pml.png" STYLE="border:none;padding:0;margin:0;"></A> Marcus Schuler / <A HREF="https://example.com/">Example</A>:<BR> <SPAN STYLE="font-size:1.3em;"><B><A HREF="https://example.com/framework">Publisher announces a five-principle framework for durable development</A></B></SPAN>&nbsp; &mdash;&nbsp; Publisher published a five-principle framework on Sunday for durable development.</P>'
    }), entry('optout-raw', {
      title: 'New Year, New Digital You',
      source_title: 'News from the Opt Out Project',
      published_at: Date.now() - 2 * 60 * 60 * 1000,
      summary_text: '<p>Dear followers of The Opt Out Project,</p> <p>Today I announce the start of <a href="https://www.optoutproject.net/the-cyber-cleanse-take-back-your-digital-footprint/" rel="noopener noreferrer nofollow" target="_blank">Take Back Your Digital Footprint</a>: <strong>a 21-day cyber-cleanse designed to help you retrieve your digital life from the Tech giants.</strong></p>'.repeat(4)
    })]} onOpenEntry={() => undefined} />);

    const previews = [...host.querySelectorAll('.entry-excerpt')].map((node) => node.textContent ?? '');
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview).not.toMatch(/[<>]|href=|target=|IMG|<\/p>/i);
      expect(preview.length).toBeLessThanOrEqual(181);
    }
    expect(previews.some((preview) => preview.includes('Publisher published a five-principle framework on Sunday'))).toBe(true);
    expect(previews.some((preview) => preview.includes('Dear followers of The Opt Out Project'))).toBe(true);
  });

  it('wires Today header search and refresh actions', async () => {
    const onSearch = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    const host = render(<TodayView entries={[entry('one')]} onOpenEntry={() => undefined} onSearch={onSearch} onRefresh={onRefresh} />);

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click());

    expect(onSearch).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

});
