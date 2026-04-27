import type { Entry, EntryUserState, EntryWithState, Feed, FeedFetchRun, Subscription, UnixMs, User } from '../../src/shared/types';

export interface RefreshQueueState {
  feed_id: string;
  next_poll_at: UnixMs;
  last_polled_at: UnixMs | null;
  last_success_at: UnixMs | null;
  failure_count: number;
}

export class FakeQueue {
  readonly messages: unknown[] = [];

  async send(body: unknown): Promise<void> {
    this.messages.push(body);
  }
}

function sqlIncludes(sql: string, text: string): boolean {
  return sql.replace(/\s+/g, ' ').includes(text);
}

class FakeStatement {
  private args: unknown[] = [];

  constructor(private readonly sql: string, private readonly db: FakeRillD1) {}

  private entryState(entryId: string): EntryUserState | undefined {
    return this.db.entryStates.find((state) => state.user_id === this.db.user.id && state.entry_id === entryId);
  }

  private entryWithState(entry: Entry): EntryWithState {
    const feed = this.db.feeds.find((candidate) => candidate.id === entry.feed_id);
    const state = this.entryState(entry.id);
    return {
      ...entry,
      source_title: feed?.title ?? null,
      read_at: state?.read_at ?? null,
      saved_at: state?.saved_at ?? null,
      archived_at: state?.archived_at ?? null,
      last_opened_at: state?.last_opened_at ?? null
    };
  }

  private activeEntry(entry: Entry): boolean {
    return this.db.subscriptions.some((subscription) => subscription.user_id === this.db.user.id && subscription.feed_id === entry.feed_id && subscription.is_archived === 0);
  }

  bind(...args: unknown[]): FakeStatement {
    this.args = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (sqlIncludes(this.sql, 'FROM entry_user_state') && sqlIncludes(this.sql, 'WHERE user_id = ? AND entry_id = ?')) {
      return (this.db.entryStates.find((state) => state.user_id === this.args[0] && state.entry_id === this.args[1]) ?? null) as T | null;
    }
    if (sqlIncludes(this.sql, 'FROM entries e') && sqlIncludes(this.sql, 'WHERE e.id = ?')) {
      const entryId = this.args[1] as string;
      const entry = this.db.entries.find((candidate) => candidate.id === entryId && this.activeEntry(candidate));
      return entry ? this.entryWithState(entry) as T : null;
    }
    if (sqlIncludes(this.sql, 'FROM subscriptions') && sqlIncludes(this.sql, 'WHERE user_id = ? AND id = ?')) {
      return (this.db.subscriptions.find((subscription) => subscription.user_id === this.args[0] && subscription.id === this.args[1]) ?? null) as T | null;
    }
    if (sqlIncludes(this.sql, 'FROM feeds') && sqlIncludes(this.sql, 'WHERE id = ?')) {
      return (this.db.feeds.find((feed) => feed.id === this.args[0]) ?? null) as T | null;
    }
    if (sqlIncludes(this.sql, 'FROM sessions')) return this.db.session as T;
    if (sqlIncludes(this.sql, 'FROM users WHERE id')) return this.db.user as T;
    return null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    if (sqlIncludes(this.sql, 'FROM feeds f') && sqlIncludes(this.sql, 'JOIN subscriptions sub')) {
      const userId = this.args[0];
      const since = this.sql.includes('f.updated_at >') ? Number(this.args[1]) : null;
      const feedIds = new Set(this.db.subscriptions.filter((subscription) => subscription.user_id === userId).map((subscription) => subscription.feed_id));
      const rows = this.db.feeds
        .filter((feed) => feedIds.has(feed.id))
        .filter((feed) => since === null || feed.updated_at > since)
        .sort((left, right) => (left.title ?? '').localeCompare(right.title ?? '') || left.created_at - right.created_at);
      return { results: rows as T[], success: true, meta: {} };
    }
    if (sqlIncludes(this.sql, 'FROM entries e') && !sqlIncludes(this.sql, 'LEFT JOIN entry_user_state')) {
      const userId = this.args[0];
      const hasSince = this.sql.includes('e.updated_at >');
      const since = hasSince ? Number(this.args[1]) : null;
      const limit = Number(this.args[this.args.length - 1]);
      const activeFeeds = new Set(this.db.subscriptions.filter((subscription) => subscription.user_id === userId && subscription.is_archived === 0).map((subscription) => subscription.feed_id));
      const rows = this.db.entries
        .filter((entry) => activeFeeds.has(entry.feed_id))
        .filter((entry) => since === null || entry.updated_at > since)
        .sort((left, right) => (right.published_at ?? right.created_at) - (left.published_at ?? left.created_at))
        .slice(0, limit);
      return { results: rows as T[], success: true, meta: {} };
    }
    if (sqlIncludes(this.sql, 'FROM entries e')) {
      const limit = Number(this.args[this.args.length - 1]);
      const unreadOnly = sqlIncludes(this.sql, 's.read_at IS NULL');
      const rows = this.db.entries
        .filter((entry) => this.activeEntry(entry))
        .map((entry) => this.entryWithState(entry))
        .filter((entry) => entry.archived_at === null)
        .filter((entry) => !unreadOnly || entry.read_at === null)
        .sort((left, right) => (right.published_at ?? right.created_at) - (left.published_at ?? left.created_at))
        .slice(0, limit);
      return { results: rows as T[], success: true, meta: {} };
    }
    if (sqlIncludes(this.sql, 'FROM entry_user_state')) {
      const userId = this.args[0];
      const since = this.sql.includes('updated_at >') ? Number(this.args[1]) : null;
      const rows = this.db.entryStates
        .filter((state) => state.user_id === userId)
        .filter((state) => since === null || state.updated_at > since)
        .sort((left, right) => left.updated_at - right.updated_at);
      return { results: rows as T[], success: true, meta: {} };
    }
    if (sqlIncludes(this.sql, 'FROM feed_refresh_queue_state')) {
      const now = Number(this.args[0]);
      const limit = Number(this.args[1]);
      const activeFeeds = new Set(this.db.subscriptions.filter((subscription) => subscription.is_archived === 0).map((subscription) => subscription.feed_id));
      const due = this.db.queueStates
        .filter((state) => state.next_poll_at <= now && activeFeeds.has(state.feed_id))
        .sort((left, right) => left.next_poll_at - right.next_poll_at)
        .slice(0, limit)
        .map((state) => ({ feed_id: state.feed_id }));
      return { results: due as T[], success: true, meta: {} };
    }
    if (sqlIncludes(this.sql, 'FROM subscriptions sub') && sqlIncludes(this.sql, 'JOIN feeds f')) {
      const userId = this.args[0];
      const rows = this.db.subscriptions
        .filter((subscription) => subscription.user_id === userId && subscription.is_archived === 0)
        .map((subscription) => {
          const feed = this.db.feeds.find((candidate) => candidate.id === subscription.feed_id);
          return feed ? { title: feed.title, canonical_feed_url: feed.canonical_feed_url, site_url: feed.site_url, folder: subscription.folder } : null;
        })
        .filter((row): row is { title: string | null; canonical_feed_url: string; site_url: string | null; folder: string | null } => row !== null);
      return { results: rows as T[], success: true, meta: {} };
    }
    if (sqlIncludes(this.sql, 'FROM subscriptions')) {
      const userId = this.args[0];
      const since = this.sql.includes('updated_at >') ? Number(this.args[1]) : null;
      return { results: this.db.subscriptions.filter((subscription) => subscription.user_id === userId).filter((subscription) => since === null || subscription.updated_at > since) as T[], success: true, meta: {} };
    }
    return { results: [] as T[], success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: Record<string, never> }> {
    if (sqlIncludes(this.sql, 'INSERT INTO entries')) this.upsertEntry();
    if (sqlIncludes(this.sql, 'INSERT INTO feeds')) this.upsertFeed();
    if (sqlIncludes(this.sql, 'INSERT INTO subscriptions')) this.upsertSubscription();
    if (sqlIncludes(this.sql, 'UPDATE subscriptions')) this.updateSubscription();
    if (sqlIncludes(this.sql, 'DELETE FROM subscriptions')) this.deleteSubscription();
    if (sqlIncludes(this.sql, 'UPDATE feeds')) this.updateFeed();
    if (sqlIncludes(this.sql, 'INSERT INTO feed_fetch_runs')) this.insertFetchRun();
    if (sqlIncludes(this.sql, 'INSERT INTO feed_refresh_queue_state')) this.upsertQueueState();
    if (sqlIncludes(this.sql, 'INSERT INTO entry_user_state')) this.upsertEntryState();
    this.db.runs.push({ sql: this.sql, args: this.args });
    return { success: true, meta: {} };
  }

  private upsertFeed(): void {
    const [id, canonical_feed_url, site_url, discovered_from_url, feed_type, title, description, language, etag, last_modified, icon_url, updated_at, created_at] = this.args as [string, string, string | null, string | null, Feed['feed_type'], string | null, string | null, string | null, string | null, string | null, string | null, UnixMs, UnixMs];
    const existing = this.db.feeds.find((feed) => feed.canonical_feed_url === canonical_feed_url);
    const next: Feed = { id, canonical_feed_url, site_url, discovered_from_url, feed_type, title, description, language, etag, last_modified, icon_url, updated_at, created_at };
    if (existing) Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
    else this.db.feeds.push(next);
  }

  private upsertSubscription(): void {
    const [id, user_id, feed_id, folder, sort_order, is_archived, created_at, updated_at] = this.args as [string, string, string, string | null, number, 0 | 1, UnixMs, UnixMs];
    const existing = this.db.subscriptions.find((subscription) => subscription.user_id === user_id && subscription.feed_id === feed_id);
    const next: Subscription = { id, user_id, feed_id, folder, sort_order, is_archived, created_at, updated_at };
    if (existing) Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
    else this.db.subscriptions.push(next);
  }


  private updateSubscription(): void {
    const [folder, sort_order, is_archived, updated_at, user_id, id] = this.args as [string | null, number, 0 | 1, UnixMs, string, string];
    const subscription = this.db.subscriptions.find((candidate) => candidate.user_id === user_id && candidate.id === id);
    if (!subscription) return;
    subscription.folder = folder;
    subscription.sort_order = sort_order;
    subscription.is_archived = is_archived;
    subscription.updated_at = updated_at;
  }

  private deleteSubscription(): void {
    const [user_id, id] = this.args as [string, string];
    this.db.subscriptions = this.db.subscriptions.filter((subscription) => !(subscription.user_id === user_id && subscription.id === id));
  }

  private upsertEntry(): void {
    const [
      id,
      feed_id,
      stable_external_id,
      canonical_url,
      title,
      author,
      published_at,
      updated_at_feed,
      summary_text,
      content_text,
      content_html_sanitized,
      content_html_raw,
      has_remote_images,
      content_hash,
      created_at,
      updated_at
    ] = this.args as [string, string, string, string | null, string | null, string | null, UnixMs | null, UnixMs | null, string | null, string | null, string | null, string | null, 0 | 1, string | null, UnixMs, UnixMs];
    const existing = this.db.entries.find((entry) => entry.feed_id === feed_id && entry.stable_external_id === stable_external_id);
    const next: Entry = {
      id,
      feed_id,
      stable_external_id,
      canonical_url,
      title,
      author,
      published_at,
      updated_at_feed,
      summary_text,
      content_text,
      content_html_sanitized,
      content_html_raw,
      has_remote_images,
      content_hash,
      created_at: existing?.created_at ?? created_at,
      updated_at
    };
    if (existing) Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
    else this.db.entries.push(next);
  }

  private updateFeed(): void {
    const [title, description, language, siteUrl, etag, lastModified, updatedAt, feedId] = this.args as [string | null, string | null, string | null, string | null, string | null, string | null, UnixMs, string];
    const feed = this.db.feeds.find((candidate) => candidate.id === feedId);
    if (!feed) return;
    feed.title = title ?? feed.title;
    feed.description = description ?? feed.description;
    feed.language = language ?? feed.language;
    feed.site_url = siteUrl ?? feed.site_url;
    feed.etag = etag;
    feed.last_modified = lastModified;
    feed.updated_at = updatedAt;
  }

  private upsertEntryState(): void {
    const [user_id, entry_id, read_at, saved_at, archived_at, updated_at, patchRead, patchSaved, patchArchived] = this.args as [string, string, UnixMs | null, UnixMs | null, UnixMs | null, UnixMs, number, number, number];
    const existing = this.db.entryStates.find((state) => state.user_id === user_id && state.entry_id === entry_id);
    if (existing) {
      if (patchRead) existing.read_at = read_at;
      if (patchSaved) existing.saved_at = saved_at;
      if (patchArchived) existing.archived_at = archived_at;
      existing.updated_at = updated_at;
      return;
    }
    this.db.entryStates.push({ user_id, entry_id, read_at, saved_at, archived_at, last_opened_at: null, updated_at });
  }

  private insertFetchRun(): void {
    const [id, feed_id, started_at, finished_at, status, http_status, bytes_received, error_code, error_detail] = this.args as [string, string, UnixMs, UnixMs | null, FeedFetchRun['status'], number | null, number | null, string | null, string | null];
    this.db.fetchRuns.push({ id, feed_id, started_at, finished_at, status, http_status, bytes_received, error_code, error_detail });
  }

  private upsertQueueState(): void {
    const [feed_id, next_poll_at, last_polled_at, last_success_at, failure_count] = this.args as [string, UnixMs, UnixMs | null, UnixMs | null, number];
    const existing = this.db.queueStates.find((state) => state.feed_id === feed_id);
    const next = { feed_id, next_poll_at, last_polled_at, last_success_at, failure_count };
    if (existing) Object.assign(existing, next);
    else this.db.queueStates.push(next);
  }
}

export class FakeRillD1 {
  readonly runs: Array<{ sql: string; args: unknown[] }> = [];
  feeds: Feed[] = [];
  entries: Entry[] = [];
  entryStates: EntryUserState[] = [];
  fetchRuns: FeedFetchRun[] = [];
  queueStates: RefreshQueueState[] = [];
  subscriptions: Subscription[] = [];
  user: User = { id: 'user-1', handle: 'samay', created_at: 1, updated_at: 1 };
  session = { id: 'session-1', user_id: 'user-1', expires_at: Date.parse('2026-05-01T00:00:00Z'), created_at: 1, last_seen_at: 1 };

  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql, this);
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

export function feed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 'feed-1',
    canonical_feed_url: 'https://example.com/feed.xml',
    site_url: 'https://example.com/',
    discovered_from_url: null,
    feed_type: 'rss',
    title: 'Old feed title',
    description: null,
    language: null,
    etag: null,
    last_modified: null,
    icon_url: null,
    updated_at: 1,
    created_at: 1,
    ...overrides
  };
}

export function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    user_id: 'user-1',
    feed_id: 'feed-1',
    folder: null,
    sort_order: 0,
    is_archived: 0,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}
