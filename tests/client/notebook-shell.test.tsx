import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AppView } from '../../src/client/design';
import { Shell } from '../../src/client/views/Shell';
import { SourcesView, type SourceViewModel } from '../../src/client/views/SourcesView';
import { TodayPreview } from '../../src/client/views/TodayPreview';

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


const sources: SourceViewModel[] = [
  { id: 'active', title: 'Notebook Letters', url: 'https://example.com/feed.xml', siteUrl: 'https://example.com', updatedAt: Date.now(), unreadCount: 3, isArchived: false },
  { id: 'refreshing', title: 'Refreshing Source', url: 'https://refresh.example/feed.xml', siteUrl: null, updatedAt: Date.now(), unreadCount: 1, isArchived: false, isRefreshing: true },
  { id: 'archived', title: 'Archived Source', url: 'https://archive.example/feed.xml', siteUrl: null, updatedAt: Date.now(), unreadCount: 0, isArchived: true }
];

describe('Notebook shell', () => {
  it('renders Notebook navigation without external assets', () => {
    const host = render(
      <Shell activeView="today" unreadCount={12} onNavigate={() => undefined}>
        <TodayPreview />
      </Shell>
    );

    expect(host.querySelector('.wordmark')?.textContent).toBe('rill');
    expect(host.querySelector('.sidebar')).not.toBeNull();
    expect(host.querySelectorAll('.side-nav-item')).toHaveLength(4);
    expect(host.querySelector('.unread-badge')?.textContent).toBe('12');
    expect(host.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    expect(document.documentElement.outerHTML).not.toContain('fonts.' + 'googleapis');
  });

  it('renders unread and read row visual states', () => {
    const host = render(
      <Shell activeView="today" unreadCount={3} onNavigate={() => undefined}>
        <TodayPreview />
      </Shell>
    );

    expect(host.querySelector('[data-state="unread"] .entry-dot')).not.toBeNull();
    expect(host.querySelector('[data-state="read"]')).not.toBeNull();
    expect(host.querySelector('.saved-star')).not.toBeNull();
    expect(host.textContent).toContain('25 more from the past week');
  });

  it('renders sources active refreshing and archived states', () => {
    const navigations: AppView[] = [];
    const host = render(
      <Shell activeView="sources" unreadCount={3} onNavigate={(view) => navigations.push(view)}>
        <SourcesView sources={sources} onAddSource={() => navigations.push('add-source')} />
      </Shell>
    );

    expect(host.querySelector('[data-state="active"]')).not.toBeNull();
    expect(host.querySelector('[data-state="refreshing"]')?.textContent).toContain('Refreshing...');
    expect(host.querySelector('[data-state="archived"]')?.textContent).toContain('archived');
    expect(host.textContent).toContain('2 active sources');
  });
});
