import { describe, expect, it } from 'vitest';
import { hashToken } from '../../src/worker/auth';
import { handleIngestRoute } from '../../src/worker/routes/ingest';
import { normalizeLetterTitle } from '../../src/worker/letters';
import type { Env } from '../../src/worker/env';
import type { Entry } from '../../src/shared/types';
import { FakeQueue, FakeRillD1, feed, subscription } from './fakeRillD1';

const LEVINE = 'https://www.bloomberg.com/opinion/authors/ARbTQlRLRjE/matthew-s-levine.rss';
const DAY = 24 * 60 * 60 * 1000;
const NOV16 = Date.parse('2026-11-16T19:37:00Z');

// FakeRillD1 answers the app's own SQL by pattern; the letters helpers tag theirs (/* letters:... */) and are
// answered here, against the same arrays.
class LetterD1 extends FakeRillD1 {
  prepare(sql: string) {
    const tag = sql.match(/\/\* letters:([a-z-]+) \*\//)?.[1];
    if (!tag) return super.prepare(sql);
    const db = this;
    let args: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { args = values; return statement; },
      async first<T>(): Promise<T | null> {
        if (tag === 'feed-by-url') return (db.feeds.find((f) => f.canonical_feed_url === args[0]) ?? null) as T | null;
        if (tag === 'subscribed') return (db.subscriptions.some((s) => s.user_id === args[0] && s.feed_id === args[1]) ? { ok: 1 } : null) as T | null;
        if (tag === 'state') return (db.entryStates.find((s) => s.user_id === args[0] && s.entry_id === args[1]) ?? null) as T | null;
        return null;
      },
      async all<T>() {
        const [feedId, from, to] = args as [string, number, number];
        const rows = db.entries.filter((e) => e.feed_id === feedId && (e.published_at ?? e.created_at) >= from && (e.published_at ?? e.created_at) <= to);
        return { results: rows as T[], success: true as const, meta: {} };
      },
      async run() {
        if (tag === 'upgrade') {
          const [summary_text, content_text, content_html_sanitized, has_remote_images, content_hash, updated_at, id] = args as [string, string, string, 0 | 1, string, number, string];
          const entry = db.entries.find((e) => e.id === id);
          if (entry) Object.assign(entry, { summary_text, content_text, content_html_sanitized, content_html_raw: null, has_remote_images, content_hash, updated_at });
        }
        if (tag === 'carry-state' || tag === 'archive') {
          const [user_id, entry_id] = args as [string, string];
          let state = db.entryStates.find((s) => s.user_id === user_id && s.entry_id === entry_id);
          if (!state) {
            state = { user_id, entry_id, read_at: null, saved_at: null, archived_at: null, last_opened_at: null, updated_at: 0 };
            db.entryStates.push(state);
          }
          if (tag === 'carry-state') {
            state.read_at ??= args[2] as number | null;
            state.saved_at ??= args[3] as number | null;
            state.updated_at = args[4] as number;
          } else {
            state.archived_at ??= args[2] as number;
            state.updated_at = args[3] as number;
          }
        }
        return { success: true as const, meta: {} };
      }
    };
    return statement as never;
  }
}

function levineDb(): LetterD1 {
  const db = new LetterD1();
  db.feeds.push(feed({ id: 'feed-levine', canonical_feed_url: LEVINE, site_url: 'https://www.bloomberg.com/opinion', title: 'Matt Levine - Bloomberg Opinion' }));
  db.subscriptions.push(subscription({ id: 'sub-levine', feed_id: 'feed-levine' }));
  return db;
}

function teaser(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry:feed-levine:guid-1', feed_id: 'feed-levine', stable_external_id: 'guid-1',
    canonical_url: 'https://www.bloomberg.com/opinion/newsletters/2026-11-16/people-miss-jensen-huang-already',
    title: 'People Miss Jensen Huang Already', author: 'Matt Levine', published_at: NOV16 - 2 * 60 * 60 * 1000, updated_at_feed: null,
    summary_text: 'Also antitrust and x-risk.', content_text: 'Also antitrust and x-risk.', content_html_sanitized: '<p>Also antitrust and x-risk.</p>',
    content_html_raw: '<p>Also antitrust and x-risk.</p>', has_remote_images: 0, content_hash: 'abc', created_at: 1, updated_at: 1,
    ...overrides
  };
}

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

const letter = {
  feed_url: LEVINE,
  message_id: '1a1e5ddc99acb504',
  title: 'People Miss Jensen Huang Already',
  published_at: NOV16,
  html: '<h3>Oh Jensen</h3><p>Some hypotheticals. What if Dario Amodei got caught having an affair?</p><script>x()</script><h3>Things happen</h3><p>Links.</p>'
};

function post(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('https://rill.local/api/ingest/letter', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('letters from the inbox', () => {
  it('needs the ingest token', async () => {
    const db = levineDb();
    const env = await envFor(db);
    expect((await handleIngestRoute(post(letter), env))?.status).toBe(401);
    expect((await handleIngestRoute(post(letter, 'wrong'), env))?.status).toBe(401);
    expect(db.entries).toHaveLength(0);
  });

  it('refuses a feed Rill does not follow and a malformed letter', async () => {
    const db = levineDb();
    const env = await envFor(db);
    expect((await handleIngestRoute(post({ ...letter, feed_url: 'https://elsewhere.example/feed' }, 'mini-secret'), env))?.status).toBe(404);
    expect((await handleIngestRoute(post({ ...letter, message_id: '../x' }, 'mini-secret'), env))?.status).toBe(400);
    expect(db.entries).toHaveLength(0);
  });

  it('turns the teaser into the full letter in place and keeps its read state', async () => {
    const db = levineDb();
    db.entries.push(teaser({ title: 'People Miss Jensen Huang Already!' }));
    db.entryStates.push({ user_id: 'user-1', entry_id: 'entry:feed-levine:guid-1', read_at: 7, saved_at: null, archived_at: null, last_opened_at: 7, updated_at: 7 });
    const response = await handleIngestRoute(post(letter, 'mini-secret'), await envFor(db), () => 9000);
    await expect(response?.json()).resolves.toMatchObject({ ok: true, mode: 'upgraded', entry_id: 'entry:feed-levine:guid-1' });
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].content_html_sanitized).toContain('Oh Jensen');
    expect(db.entries[0].content_html_sanitized).not.toContain('<script');
    expect(db.entries[0].content_hash).toMatch(/^letter:/);
    expect(db.entries[0].content_html_raw).toBeNull();
    expect(db.entryStates[0].read_at).toBe(7);
  });

  it('lands on its own when the feed has no such entry, and a repeat post does not duplicate it', async () => {
    const db = levineDb();
    db.entries.push(teaser({ title: 'Something Else Entirely', published_at: NOV16 - 10 * DAY }));
    const env = await envFor(db);
    const first = await handleIngestRoute(post(letter, 'mini-secret'), env, () => 9000);
    await expect(first?.json()).resolves.toMatchObject({ ok: true, mode: 'inserted', entry_id: 'entry:feed-levine:letter:1a1e5ddc99acb504' });
    await handleIngestRoute(post(letter, 'mini-secret'), env, () => 9500);
    expect(db.entries.filter((e) => e.stable_external_id.startsWith('letter:'))).toHaveLength(1);
    expect(db.entries.find((e) => e.stable_external_id.startsWith('letter:'))?.content_hash).toMatch(/^letter:/);
  });

  it('folds a standalone letter into the teaser once the feed carries it', async () => {
    const db = levineDb();
    const env = await envFor(db);
    await handleIngestRoute(post(letter, 'mini-secret'), env, () => 9000);
    const standaloneId = 'entry:feed-levine:letter:1a1e5ddc99acb504';
    db.entryStates.push({ user_id: 'user-1', entry_id: standaloneId, read_at: 9100, saved_at: 9200, archived_at: null, last_opened_at: 9100, updated_at: 9200 });
    db.entries.push(teaser());
    const again = await handleIngestRoute(post(letter, 'mini-secret'), env, () => 9900);
    await expect(again?.json()).resolves.toMatchObject({ ok: true, mode: 'upgraded', entry_id: 'entry:feed-levine:guid-1', folded: true });
    const feedState = db.entryStates.find((s) => s.entry_id === 'entry:feed-levine:guid-1');
    expect(feedState).toMatchObject({ read_at: 9100, saved_at: 9200 });
    expect(db.entryStates.find((s) => s.entry_id === standaloneId)?.archived_at).toBe(9900);
  });

  it('matches titles across quote style, case and punctuation', () => {
    expect(normalizeLetterTitle('Huang’s “Exit”, Again')).toBe(normalizeLetterTitle("huang's \"exit\" again"));
  });

  it('leaves the edition route as it was', async () => {
    const db = levineDb();
    const response = await handleIngestRoute(new Request('https://rill.local/api/ingest/edition', { method: 'GET' }), await envFor(db));
    expect(response?.status).toBe(405);
  });
});
