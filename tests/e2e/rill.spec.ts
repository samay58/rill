import { expect, test } from '@playwright/test';

test('private reading flow stays local first and privacy clean', async ({ page, context, baseURL }) => {
  const thirdPartyRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && baseURL && url.origin !== new URL(baseURL).origin) thirdPartyRequests.push(request.url());
  });

  let unlocked = false;
  await page.route('**/api/auth/unlock', async (route) => {
    unlocked = true;
    await route.fulfill({ json: { ok: true, user: { id: 'user-1', handle: 'samay' } } });
  });
  const emptyBootstrap = {
    ok: true,
    user: { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 },
    feeds: [{ id: 'feed-1', canonical_feed_url: 'https://example.com/feed.xml', site_url: 'https://example.com/', discovered_from_url: null, feed_type: 'rss', title: 'Notebook Letters', description: null, language: null, etag: null, last_modified: null, icon_url: null, updated_at: 1, created_at: 1 }],
    subscriptions: [{ id: 'sub-1', user_id: 'user-1', feed_id: 'feed-1', folder: null, sort_order: 0, is_archived: 0, created_at: 1, updated_at: 1 }],
    entries: [{ id: 'bootstrap-entry', feed_id: 'feed-1', stable_external_id: 'bootstrap-entry', canonical_url: 'https://example.com/bootstrap-entry', title: 'Bootstrap smoke entry', author: null, published_at: Date.parse('2026-04-27T10:00:00Z'), updated_at_feed: null, summary_text: 'A cached smoke entry.', content_text: 'A cached smoke entry.', content_html_sanitized: null, content_html_raw: null, has_remote_images: 0, content_hash: null, created_at: 1, updated_at: 1 }],
    entryState: [{ user_id: 'user-1', entry_id: 'bootstrap-entry', read_at: null, saved_at: null, archived_at: null, last_opened_at: null, updated_at: 1 }],
    serverTime: 100,
    syncCursor: 100
  };
  await page.route('**/api/bootstrap', async (route) => {
    if (!unlocked) {
      await route.fulfill({
        status: 401,
        json: { ok: false, code: 'unauthorized', message: 'Unauthorized' }
      });
      return;
    }
    await route.fulfill({ json: emptyBootstrap });
  });
  await page.route('**/api/sync?since=*', async (route) => {
    await route.fulfill({ json: { ok: true, feeds: [], subscriptions: [], entries: [], entryState: [], serverTime: 200, syncCursor: 200 } });
  });
  await page.route('**/api/subscriptions', async (route) => {
    await route.fulfill({ json: { ok: true, kind: 'created', subscription: { feed_id: 'feed-test', title: 'Opt Out Project', url: 'https://www.optoutproject.net/feed/' } } });
  });

  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await page.getByLabel('Private token').fill('private-token');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await page.getByRole('button', { name: 'Sources' }).click();
  await page.getByRole('button', { name: '+ Add source' }).click();
  await page.getByLabel('Source URL').fill('https://www.optoutproject.net/feed/');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added Opt Out Project.')).toBeVisible();

  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js';
    const reactDomPath = '/node_modules/.vite/deps/react-dom_client.js';
    const appPath = '/src/client/App.tsx';
    const ReactModule = await import(/* @vite-ignore */ reactPath);
    const React = ReactModule.default ?? ReactModule;
    const ReactDOM = await import(/* @vite-ignore */ reactDomPath);
    const { App } = await import(/* @vite-ignore */ appPath);
    document.body.innerHTML = '<div id="root"></div>';
    const entries = [{
      id: 'entry-1', feed_id: 'feed-1', stable_external_id: 'entry-1', canonical_url: 'https://example.com/original', title: 'Remote image discipline', author: 'Ada', published_at: Date.parse('2026-04-27T12:00:00Z'), updated_at_feed: null, summary_text: 'A quiet summary.', content_text: 'Paragraph one.\n\nParagraph two.', content_html_sanitized: '<p>Safe paragraph.</p><img src="https://tracker.example/pixel.png"><blockquote>Quoted note.</blockquote>', content_html_raw: null, has_remote_images: 1, content_hash: null, created_at: 1, updated_at: 1, source_title: 'Notebook Letters', read_at: null, saved_at: null, archived_at: null, last_opened_at: null
    }];
    (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(document.getElementById('root')).render(React.createElement(App, { initialUnlocked: true, initialEntries: entries, clock: () => 1000 }));
  });

  await page.locator('[data-entry-id="entry-1"] .entry-open-button').click();
  await expect(page.getByRole('heading', { name: 'Remote image discipline' })).toBeVisible();
  await expect(page.getByText('1 remote image hidden')).toBeVisible();
  await expect(page.locator('img[src^="http"]')).toHaveCount(0);
  await page.locator('[data-action="save-entry"]').click();
  await expect(page.locator('[data-action="save-entry"]')).toHaveText('Saved');
  await page.locator('[data-action="mark-unread"]').click();
  await page.locator('[data-action="back-to-today"]').click();
  await expect(page.getByText('Remote image discipline')).toBeVisible();
  await page.locator('[data-entry-id="entry-1"] .entry-open-button').click();
  await page.locator('[data-action="archive-entry"]').click();
  await expect(page.getByText('Caught up for now')).toBeVisible();

  await page.getByRole('button', { name: 'Sources' }).click();
  await expect(page.getByLabel('Import OPML file')).toBeAttached();
  await expect(page.getByRole('link', { name: 'Export' })).toHaveAttribute('href', '/api/subscriptions/export.opml');

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.unlock-wordmark')).toHaveCount(0);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.unlock-wordmark')).toHaveCount(0);
  await context.setOffline(false);

  expect(thirdPartyRequests).toEqual([]);
});
