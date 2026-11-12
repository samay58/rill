import { describe, expect, it } from 'vitest';
import { hashToken } from '../../src/worker/auth';
import { isYouTubeShort } from '../../src/worker/feedFetch';
import { handleIngestRoute } from '../../src/worker/routes/ingest';
import type { Env } from '../../src/worker/env';
import { FakeQueue, FakeRillD1 } from './fakeRillD1';

async function envFor(db: FakeRillD1): Promise<Env> {
  return {
    DB: db.asD1(),
    REFRESH_QUEUE: new FakeQueue() as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret',
    RILL_INGEST_TOKEN_HASH: await hashToken('mini-secret'),
    RILL_INGEST_USER_ID: db.user.id
  };
}

function post(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('https://rill.local/api/ingest/edition', { method: 'POST', headers, body: JSON.stringify(body) });
}

const edition = {
  id: '2026-11-11',
  title: 'Morning Edition, Wednesday Nov 11',
  published_at: 1_700_000_000_000,
  html: '<h2>World</h2><p><a href="https://example.com/a">A headline</a> <small>Source</small></p><script>alert(1)</script>'
};

describe('Morning Edition ingest', () => {
  it('ignores other paths', async () => {
    const db = new FakeRillD1();
    const response = await handleIngestRoute(new Request('https://rill.local/api/other', { method: 'POST' }), await envFor(db));
    expect(response).toBeNull();
  });

  it('rejects a missing or wrong token', async () => {
    const db = new FakeRillD1();
    const env = await envFor(db);
    expect((await handleIngestRoute(post(edition), env))?.status).toBe(401);
    expect((await handleIngestRoute(post(edition, 'wrong'), env))?.status).toBe(401);
    expect(db.entries).toHaveLength(0);
  });

  it('rejects a malformed edition', async () => {
    const db = new FakeRillD1();
    const response = await handleIngestRoute(post({ ...edition, id: 'today' }, 'mini-secret'), await envFor(db));
    expect(response?.status).toBe(400);
  });

  it('stores the edition as a pinned feed entry with sanitized html', async () => {
    const db = new FakeRillD1();
    const response = await handleIngestRoute(post(edition, 'mini-secret'), await envFor(db), () => 5000);
    await expect(response?.json()).resolves.toMatchObject({ ok: true });
    expect(db.feeds.find((feed) => feed.canonical_feed_url === 'https://rill.local/edition')).toMatchObject({ title: 'Morning Edition' });
    expect(db.subscriptions.find((sub) => sub.feed_id === 'feed:https://rill.local/edition')).toMatchObject({ folder: 'Edition', sort_order: -1, is_archived: 0 });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0]).toMatchObject({ title: edition.title, stable_external_id: 'edition:2026-11-11', published_at: edition.published_at });
    expect(db.entries[0].content_html_sanitized).toContain('A headline');
    expect(db.entries[0].content_html_sanitized).not.toContain('<script');
  });

  it('replaces the same day instead of duplicating it', async () => {
    const db = new FakeRillD1();
    const env = await envFor(db);
    await handleIngestRoute(post(edition, 'mini-secret'), env, () => 5000);
    await handleIngestRoute(post({ ...edition, title: 'Morning Edition, rerun' }, 'mini-secret'), env, () => 6000);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].title).toBe('Morning Edition, rerun');
  });
});

describe('YouTube Shorts filter', () => {
  it('flags Shorts and keeps full videos', () => {
    expect(isYouTubeShort('https://www.youtube.com/shorts/abc123')).toBe(true);
    expect(isYouTubeShort('https://youtube.com/shorts/abc123')).toBe(true);
    expect(isYouTubeShort('https://www.youtube.com/watch?v=abc123')).toBe(false);
    expect(isYouTubeShort('https://example.com/shorts/essay')).toBe(false);
    expect(isYouTubeShort(null)).toBe(false);
  });
});
