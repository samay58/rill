import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleOpmlRoute } from '../../src/worker/routes/opml';
import type { Env } from '../../src/worker/env';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

function envFor(db: FakeRillD1): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

async function cookie(): Promise<string> {
  return createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
}

async function authed(path: string, init: RequestInit = {}): Promise<Request> {
  return new Request(`https://rill.local${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie: await cookie() } });
}

describe('OPML routes', () => {
  it('imports OPML subscriptions and skips existing feeds', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ id: 'feed:https://daringfireball.net/feeds/main', canonical_feed_url: 'https://daringfireball.net/feeds/main' }));
    db.subscriptions.push(subscription({ feed_id: 'feed:https://daringfireball.net/feeds/main' }));

    const response = await handleOpmlRoute(await authed('/api/subscriptions/import-opml', {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: fixture('subscriptions.opml')
    }), envFor(db), () => 1000);

    await expect(response?.json()).resolves.toMatchObject({ ok: true, imported: 1, skipped: 1 });
    expect(db.feeds.some((candidate) => candidate.canonical_feed_url === 'https://kottke.org/index.xml')).toBe(true);
    expect(db.subscriptions.some((candidate) => candidate.folder === 'Personal' && candidate.feed_id === 'feed:https://kottke.org/index.xml')).toBe(true);
  });

  it('exports active subscriptions as OPML', async () => {
    const db = new FakeRillD1();
    db.feeds.push(feed({ id: 'feed-1', title: 'Notebook Letters', canonical_feed_url: 'https://example.com/feed.xml', site_url: 'https://example.com/' }));
    db.subscriptions.push(subscription({ feed_id: 'feed-1', folder: 'Writing' }));

    const response = await handleOpmlRoute(await authed('/api/subscriptions/export.opml'), envFor(db), () => 1000);
    const text = await response!.text();

    expect(response?.headers.get('content-type')).toContain('text/x-opml');
    expect(text).toContain('text="Writing"');
    expect(text).toContain('xmlUrl="https://example.com/feed.xml"');
    expect(text).toContain('htmlUrl="https://example.com/"');
  });
});
