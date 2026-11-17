import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AppView } from '../../src/client/design';
import { Shell } from '../../src/client/views/Shell';
import { SourcesView, type SourceViewModel } from '../../src/client/views/SourcesView';
import { TodayView, type ReadingEntry } from '../../src/client/views/TodayView';

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

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  container?.remove();
  container = null;
  root = null;
});


function row(id: string, overrides: Partial<ReadingEntry> = {}): ReadingEntry {
  return {
    id, feed_id: 'feed-1', stable_external_id: id, canonical_url: `https://example.com/${id}`, title: `Entry ${id}`, author: null,
    published_at: Date.now() - 3_600_000, updated_at_feed: null, summary_text: 'A summary.', content_text: 'A body.', content_html_sanitized: null,
    content_html_raw: null, has_remote_images: 0, content_hash: null, created_at: 1, updated_at: 1, source_title: 'Notebook Letters',
    read_at: null, saved_at: null, archived_at: null, last_opened_at: null, ...overrides
  };
}

const entries = [row('unread'), row('read', { read_at: Date.now() - 60_000 }), row('saved', { saved_at: 1 })];

const sources: SourceViewModel[] = [
  { id: 'active', title: 'Notebook Letters', url: 'https://example.com/feed.xml', siteUrl: 'https://example.com', updatedAt: Date.now(), unreadCount: 3, isArchived: false },
  { id: 'refreshing', title: 'Refreshing Source', url: 'https://refresh.example/feed.xml', siteUrl: null, updatedAt: Date.now(), unreadCount: 1, isArchived: false, isRefreshing: true },
  { id: 'archived', title: 'Archived Source', url: 'https://archive.example/feed.xml', siteUrl: null, updatedAt: Date.now(), unreadCount: 0, isArchived: true }
];

describe('Notebook shell', () => {
  it('renders Notebook navigation without external assets', () => {
    const host = render(
      <Shell activeView="today" unreadCount={12} onNavigate={() => undefined}>
        <TodayView entries={entries} onOpenEntry={() => undefined} onToggleRead={() => undefined} />
      </Shell>
    );

    expect(host.querySelector('.wordmark')?.textContent).toBe('rill');
    expect(host.querySelector('.sidebar')).not.toBeNull();
    expect(host.querySelectorAll('.side-nav-item')).toHaveLength(4);
    expect(host.querySelector('.settings-button')).toBeNull(); // it did nothing, so it left (Nov 16 2026)
    expect(host.querySelector('.unread-badge')?.textContent).toBe('12');
    expect(host.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    expect(document.documentElement.outerHTML).not.toContain('fonts.' + 'googleapis');
  });

  it('renders unread and read row visual states', () => {
    const host = render(
      <Shell activeView="today" unreadCount={3} onNavigate={() => undefined}>
        <TodayView entries={entries} onOpenEntry={() => undefined} onToggleRead={() => undefined} />
      </Shell>
    );

    expect(host.querySelector('[data-state="unread"] .entry-dot')).not.toBeNull();
    expect(host.querySelector('[data-state="read"]')).not.toBeNull();
    expect(host.querySelector('.saved-star')).not.toBeNull();
    // The dot is the control that flips read state, named for what it does.
    expect(host.querySelector('[data-entry-id="read"] .entry-dot-button')?.getAttribute('aria-label')).toBe('Mark unread: Entry read');
    expect(host.querySelector('[data-entry-id="unread"] .entry-dot-button')?.getAttribute('aria-label')).toBe('Mark read: Entry unread');
  });

  it('renders sources active refreshing and archived states', () => {
    const navigations: AppView[] = [];
    const host = render(
      <Shell activeView="sources" unreadCount={3} onNavigate={(view) => navigations.push(view)}>
        <SourcesView sources={sources} onAddSource={() => navigations.push('add-source')} />
      </Shell>
    );

    expect(host.querySelector('[data-state="active"]')).not.toBeNull();
    expect(host.querySelector('[data-state="refreshing"]')?.textContent).toContain('Refreshing…');
    expect(host.querySelector('[data-state="archived"]')?.textContent).toContain('archived');
    expect(host.textContent).toContain('2 active sources');
  });
});
