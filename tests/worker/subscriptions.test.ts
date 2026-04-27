import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionCookie } from '../../src/worker/auth';
import { handleSubscriptionsRoute } from '../../src/worker/routes/subscriptions';
import type { Env } from '../../src/worker/env';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

class FakeStatement {
  constructor(private sql: string, private db: FakeD1) {}
  private args: unknown[] = [];
  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }
  async first<T>() {
    if (this.sql.includes('FROM sessions')) return this.db.session as T;
    if (this.sql.includes('FROM users WHERE id')) return this.db.user as T;
    return null;
  }
  async all<T>() {
    return { results: [] as T[], success: true, meta: {} };
  }
  async run() {
    this.db.runs.push({ sql: this.sql, args: this.args });
    return { success: true, meta: {} };
  }
}

class FakeD1 {
  runs: Array<{ sql: string; args: unknown[] }> = [];
  user = { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 };
  session = { id: 'session-1', user_id: 'user-1', expires_at: Date.parse('2026-05-01T00:00:00Z'), created_at: 1, last_seen_at: 1 };
  prepare(sql: string) {
    return new FakeStatement(sql, this);
  }
}

async function authedRequest(body: unknown): Promise<Request> {
  const cookie = await createSessionCookie('session-1', 'secret', Date.parse('2026-05-01T00:00:00Z'));
  return new Request('https://rill.local/api/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body)
  });
}

describe('subscriptions route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns choices when a normal site has multiple feeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture('discovery.html'), { headers: { 'content-type': 'text/html' } })));
    const env = { DB: new FakeD1(), SESSION_SECRET: 'secret' } as unknown as Env;
    const response = await handleSubscriptionsRoute(await authedRequest({ url: 'https://discover.example' }), env, () => 1000);
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { kind: string; choices: Array<{ type: string }> };
    expect(payload.kind).toBe('choices');
    expect(payload.choices.map((choice) => choice.type)).toEqual(['json', 'atom', 'rss']);
  });

  it('subscribes directly when a feed url is pasted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fixture('rss-guid.xml'), { headers: { 'content-type': 'application/rss+xml' } })));
    const db = new FakeD1();
    const env = { DB: db, SESSION_SECRET: 'secret' } as unknown as Env;
    const response = await handleSubscriptionsRoute(await authedRequest({ url: 'https://example.com/feed.xml' }), env, () => 1000);
    expect(response?.status).toBe(200);
    const payload = await response!.json() as { kind: string; subscription: { title: string } };
    expect(payload.kind).toBe('created');
    expect(payload.subscription.title).toBe('Guid Feed');
    expect(db.runs.some((run) => run.sql.includes('INSERT INTO feeds'))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes('INSERT INTO subscriptions'))).toBe(true);
  });
});
