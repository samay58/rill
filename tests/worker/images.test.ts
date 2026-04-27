import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleImageRoute } from '../../src/worker/routes/images';
import type { Env } from '../../src/worker/env';
import type { Entry } from '../../src/shared/types';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

function envFor(db: FakeRillD1): Env {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

async function cookie(): Promise<string> {
  return createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
}

async function requestFor(src: string, cookieHeader?: string): Promise<Request> {
  const headers = cookieHeader ? { cookie: cookieHeader } : undefined;
  return new Request(`https://rill.local/api/image?entry_id=entry-1&src=${encodeURIComponent(src)}`, { headers });
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    feed_id: 'feed-1',
    stable_external_id: 'entry-1',
    canonical_url: 'https://example.com/entry-1',
    title: 'Image post',
    author: null,
    published_at: 100,
    updated_at_feed: null,
    summary_text: null,
    content_text: null,
    content_html_sanitized: '<p>Image</p><img src="https://images.example/pixel.png">',
    content_html_raw: '<p>Image</p><img src="https://images.example/pixel.png">',
    has_remote_images: 1,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

function seededDb(overrides: Partial<Entry> = {}): FakeRillD1 {
  const db = new FakeRillD1();
  db.feeds.push(feed());
  db.subscriptions.push(subscription());
  db.entries.push(entry(overrides));
  return db;
}

describe('image proxy route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires authentication', async () => {
    const response = await handleImageRoute(await requestFor('https://images.example/pixel.png'), envFor(seededDb()), () => 1000, fetch);
    expect(response?.status).toBe(401);
  });

  it('proxies only listed remote images and strips ambient request headers', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBeNull();
      expect(headers.get('referer')).toBeNull();
      expect(headers.get('accept')).toContain('image/');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    });

    const response = await handleImageRoute(await requestFor('https://images.example/pixel.png', await cookie()), envFor(seededDb()), () => 1000, fetcher);

    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('image/png');
    expect(Array.from(new Uint8Array(await response!.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledWith('https://images.example/pixel.png', expect.objectContaining({ redirect: 'follow' }));
  });

  it('rejects image URLs not present on the entry', async () => {
    const response = await handleImageRoute(await requestFor('https://images.example/other.png', await cookie()), envFor(seededDb()), () => 1000, fetch);
    expect(response?.status).toBe(403);
  });

  it('rejects private network image URLs before fetching', async () => {
    const db = seededDb({ content_html_raw: '<img src="http://127.0.0.1/pixel.png">', content_html_sanitized: '<img src="http://127.0.0.1/pixel.png">' });
    const fetcher = vi.fn();
    const response = await handleImageRoute(await requestFor('http://127.0.0.1/pixel.png', await cookie()), envFor(db), () => 1000, fetcher as unknown as typeof fetch);

    expect(response?.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-image responses and oversized bodies', async () => {
    const db = seededDb();
    const htmlResponse = await handleImageRoute(await requestFor('https://images.example/pixel.png', await cookie()), envFor(db), () => 1000, async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    expect(htmlResponse?.status).toBe(415);

    const hugeResponse = await handleImageRoute(await requestFor('https://images.example/pixel.png', await cookie()), envFor(db), () => 1000, async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': '6000000' } }));
    expect(hugeResponse?.status).toBe(413);
  });

  it('returns timeout when upstream image fetch aborts', async () => {
    const response = await handleImageRoute(await requestFor('https://images.example/pixel.png', await cookie()), envFor(seededDb()), () => 1000, async () => { throw new DOMException('aborted', 'AbortError'); });
    expect(response?.status).toBe(504);
  });
});
