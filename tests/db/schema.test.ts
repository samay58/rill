import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(process.cwd(), 'migrations/0001_initial.sql'), 'utf8');

describe('initial schema migration', () => {
  it('creates every table required by the approved spec', () => {
    for (const table of [
      'users',
      'sessions',
      'feeds',
      'subscriptions',
      'entries',
      'entry_user_state',
      'feed_fetch_runs',
      'feed_refresh_queue_state'
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table} (`);
    }
  });

  it('keeps user-owned tables multi-user ready', () => {
    for (const table of ['sessions', 'subscriptions', 'entry_user_state']) {
      const start = migration.indexOf(`CREATE TABLE ${table} (`);
      const end = migration.indexOf('\n);', start);
      const ddl = migration.slice(start, end);
      expect(ddl).toContain('user_id TEXT NOT NULL');
    }
  });

  it('preserves dedupe and state constraints', () => {
    expect(migration).toContain('UNIQUE (user_id, feed_id)');
    expect(migration).toContain('UNIQUE (feed_id, stable_external_id)');
    expect(migration).toContain('PRIMARY KEY (user_id, entry_id)');
    expect(migration).toContain("CHECK (feed_type IN ('rss', 'atom', 'json'))");
  });

  it('stores raw feed html but keeps sanitized html explicit', () => {
    expect(migration).toContain('content_html_sanitized TEXT');
    expect(migration).toContain('content_html_raw TEXT');
  });
});
