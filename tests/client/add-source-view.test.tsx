import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddSourceView } from '../../src/client/views/AddSourceView';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(element: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(element);
  });
}

async function fillAndSubmit(url: string) {
  const input = container!.querySelector<HTMLInputElement>('input[aria-label="Source URL"]')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, url);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container!.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('AddSourceView', () => {
  it('notifies the app after a source is created so local sync can refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, kind: 'created', subscription: { feed_id: 'feed-1', title: 'Fresh Feed', url: 'https://example.com/feed.xml' } }), { headers: { 'content-type': 'application/json' } })));
    const onSourceAdded = vi.fn();

    render(<AddSourceView onSourceAdded={onSourceAdded} />);
    await fillAndSubmit('https://example.com/feed.xml');

    expect(container!.textContent).toContain('Added Fresh Feed.');
    expect(onSourceAdded).toHaveBeenCalledOnce();
  });
});
