import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import type { ReadingEntry } from '../../src/client/views/TodayView';
import { TodayView } from '../../src/client/views/TodayView';

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

  it('opens Reader and marks the entry read before returning to Today', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('one', { title: 'The quiet loop' })]} clock={() => 1000} />);

    click('[data-entry-id="one"] .entry-open-button');
    expect(host.querySelector('.reader-article h1')?.textContent).toBe('The quiet loop');
    click('[data-action="back-to-today"]');

    expect(host.textContent).toContain('Caught up for now');
    expect(host.textContent).not.toContain('The quiet loop');
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
