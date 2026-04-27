import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import type { ReadingEntry } from '../../src/client/views/TodayView';

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
    published_at: 100,
    updated_at_feed: null,
    summary_text: 'A saved note for later.',
    content_text: 'Saved body.',
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

describe('SavedView', () => {
  it('shows saved unarchived entries newest first and opens Reader', () => {
    const host = render(<App initialUnlocked initialEntries={[
      entry('unsaved', { title: 'Unsaved entry' }),
      entry('older', { title: 'Older saved', saved_at: 10 }),
      entry('newer', { title: 'Newer saved', saved_at: 20 }),
      entry('archived', { title: 'Archived saved', saved_at: 30, archived_at: 40 })
    ]} />);

    click('button[aria-label="Saved"]');

    expect(host.textContent).toContain('Saved');
    expect(host.textContent).toContain('Newer saved');
    expect(host.textContent).toContain('Older saved');
    expect(host.textContent).not.toContain('Unsaved entry');
    expect(host.textContent).not.toContain('Archived saved');
    expect([...host.querySelectorAll('.entry-row h2')].map((node) => node.textContent)).toEqual(['Newer saved', 'Older saved']);

    click('[data-entry-id="newer"] .entry-open-button');
    expect(host.querySelector('.reader-article h1')?.textContent).toBe('Newer saved');
  });

  it('renders a quiet empty state when nothing is saved', () => {
    const host = render(<App initialUnlocked initialEntries={[entry('unsaved')]} />);

    click('button[aria-label="Saved"]');

    expect(host.textContent).toContain('No saved entries yet');
    expect(host.querySelectorAll('.entry-row')).toHaveLength(0);
  });
});
