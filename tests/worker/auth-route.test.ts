import { describe, expect, it } from 'vitest';
import { handleAuthRoute } from '../../src/worker/routes/auth';
import type { Env } from '../../src/worker/env';

class MissingSchemaD1 {
  prepare() {
    return {
      bind() { return this; },
      async first() { throw new Error('D1_ERROR: no such table: users: SQLITE_ERROR'); },
      async run() { throw new Error('not used'); }
    };
  }
}

function envFor(db: unknown): Env {
  return {
    DB: db as D1Database,
    REFRESH_QUEUE: { send: async () => undefined } as unknown as Queue,
    ASSETS: { fetch: async () => new Response('not used') } as unknown as Fetcher,
    SESSION_SECRET: 'secret'
  };
}

function unlockRequest(token = 'dev-token'): Request {
  return new Request('https://rill.local/api/auth/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
}

describe('auth route', () => {
  it('returns JSON guidance when local D1 has not been migrated', async () => {
    const response = await handleAuthRoute(unlockRequest(), envFor(new MissingSchemaD1()), () => 1000);
    const payload = await response!.json() as { ok: false; code: string; message: string };

    expect(response?.status).toBe(503);
    expect(payload.code).toBe('database_uninitialized');
    expect(payload.message).toContain('npm run setup:local');
  });
});
