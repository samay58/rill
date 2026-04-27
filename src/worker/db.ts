import { compareRankedEntries, rankSearchEntry } from '../shared/entryText';
import type {
  Entry,
  EntryStatePatch,
  EntryUserState,
  EntryWithState,
  Feed,
  FeedFetchRun,
  Session,
  Subscription,
  UnixMs,
  User
} from '../shared/types';

export interface NewSession {
  id: string;
  user_id: string;
  expires_at: UnixMs;
  created_at: UnixMs;
  last_seen_at: UnixMs;
}

export interface NewFeed extends Feed {}
export interface NewEntry extends Entry {}
export interface NewSubscription extends Subscription {}
export interface NewFetchRun extends FeedFetchRun {}

export interface SubscriptionFeedExport {
  title: string | null;
  canonical_feed_url: string;
  site_url: string | null;
  folder: string | null;
}

export async function getUserByHandle(db: D1Database, handle: string): Promise<(User & { token_hash: string }) | null> {
  return db.prepare('SELECT id, handle, token_hash, created_at, updated_at FROM users WHERE handle = ?').bind(handle).first<User & { token_hash: string }>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return db.prepare('SELECT id, handle, created_at, updated_at FROM users WHERE id = ?').bind(id).first<User>();
}

export async function createSession(db: D1Database, session: NewSession): Promise<void> {
  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(session.id, session.user_id, session.expires_at, session.created_at, session.last_seen_at).run();
}

export async function getSession(db: D1Database, id: string, now: UnixMs): Promise<Session | null> {
  return db.prepare(`
    SELECT id, user_id, expires_at, created_at, last_seen_at
    FROM sessions
    WHERE id = ? AND expires_at > ?
  `).bind(id, now).first<Session>();
}

export async function upsertFeed(db: D1Database, feed: NewFeed): Promise<void> {
  await db.prepare(`
    INSERT INTO feeds (
      id, canonical_feed_url, site_url, discovered_from_url, feed_type, title, description,
      language, etag, last_modified, icon_url, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_feed_url) DO UPDATE SET
      site_url = excluded.site_url,
      discovered_from_url = COALESCE(feeds.discovered_from_url, excluded.discovered_from_url),
      feed_type = excluded.feed_type,
      title = excluded.title,
      description = excluded.description,
      language = excluded.language,
      etag = excluded.etag,
      last_modified = excluded.last_modified,
      icon_url = excluded.icon_url,
      updated_at = excluded.updated_at
  `).bind(
    feed.id,
    feed.canonical_feed_url,
    feed.site_url,
    feed.discovered_from_url,
    feed.feed_type,
    feed.title,
    feed.description,
    feed.language,
    feed.etag,
    feed.last_modified,
    feed.icon_url,
    feed.updated_at,
    feed.created_at
  ).run();
}

export async function createSubscription(db: D1Database, subscription: NewSubscription): Promise<void> {
  await db.prepare(`
    INSERT INTO subscriptions (id, user_id, feed_id, folder, sort_order, is_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, feed_id) DO UPDATE SET
      is_archived = 0,
      folder = excluded.folder,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).bind(
    subscription.id,
    subscription.user_id,
    subscription.feed_id,
    subscription.folder,
    subscription.sort_order,
    subscription.is_archived,
    subscription.created_at,
    subscription.updated_at
  ).run();
}


export interface SubscriptionPatch {
  folder?: string | null;
  sort_order?: number;
  is_archived?: 0 | 1;
}

export async function getSubscriptionForUser(db: D1Database, userId: string, subscriptionId: string): Promise<Subscription | null> {
  return db.prepare(`
    SELECT id, user_id, feed_id, folder, sort_order, is_archived, created_at, updated_at
    FROM subscriptions
    WHERE user_id = ? AND id = ?
  `).bind(userId, subscriptionId).first<Subscription>();
}

export async function patchSubscription(db: D1Database, userId: string, subscriptionId: string, patch: SubscriptionPatch, now: UnixMs): Promise<Subscription | null> {
  const existing = await getSubscriptionForUser(db, userId, subscriptionId);
  if (!existing) return null;
  await db.prepare(`
    UPDATE subscriptions
    SET folder = ?, sort_order = ?, is_archived = ?, updated_at = ?
    WHERE user_id = ? AND id = ?
  `).bind(
    patch.folder === undefined ? existing.folder : patch.folder,
    patch.sort_order === undefined ? existing.sort_order : patch.sort_order,
    patch.is_archived === undefined ? existing.is_archived : patch.is_archived,
    now,
    userId,
    subscriptionId
  ).run();
  return getSubscriptionForUser(db, userId, subscriptionId);
}

export async function deleteSubscription(db: D1Database, userId: string, subscriptionId: string): Promise<boolean> {
  const existing = await getSubscriptionForUser(db, userId, subscriptionId);
  if (!existing) return false;
  await db.prepare(`
    DELETE FROM subscriptions
    WHERE user_id = ? AND id = ?
  `).bind(userId, subscriptionId).run();
  return true;
}

export async function listSubscriptions(db: D1Database, userId: string, since?: UnixMs): Promise<Subscription[]> {
  const sinceClause = since === undefined ? '' : 'AND updated_at > ?';
  const args = since === undefined ? [userId] : [userId, since];
  const result = await db.prepare(`
    SELECT id, user_id, feed_id, folder, sort_order, is_archived, created_at, updated_at
    FROM subscriptions
    WHERE user_id = ? ${sinceClause}
    ORDER BY sort_order ASC, created_at ASC
  `).bind(...args).all<Subscription>();
  return result.results;
}

export async function listFeedsForUser(db: D1Database, userId: string, since?: UnixMs): Promise<Feed[]> {
  const sinceClause = since === undefined ? '' : 'AND f.updated_at > ?';
  const args = since === undefined ? [userId] : [userId, since];
  const result = await db.prepare(`
    SELECT f.id, f.canonical_feed_url, f.site_url, f.discovered_from_url, f.feed_type, f.title,
      f.description, f.language, f.etag, f.last_modified, f.icon_url, f.updated_at, f.created_at
    FROM feeds f
    JOIN subscriptions sub ON sub.feed_id = f.id
    WHERE sub.user_id = ? ${sinceClause}
    ORDER BY f.title ASC, f.created_at ASC
  `).bind(...args).all<Feed>();
  return result.results;
}

export async function listEntriesForUser(db: D1Database, userId: string, limit = 100, since?: UnixMs): Promise<Entry[]> {
  const sinceClause = since === undefined ? '' : 'AND e.updated_at > ?';
  const args: unknown[] = [userId];
  if (since !== undefined) args.push(since);
  args.push(limit);
  const result = await db.prepare(`
    SELECT e.id, e.feed_id, e.stable_external_id, e.canonical_url, e.title, e.author,
      e.published_at, e.updated_at_feed, e.summary_text, e.content_text, e.content_html_sanitized,
      e.content_html_raw, e.has_remote_images, e.content_hash, e.created_at, e.updated_at
    FROM entries e
    JOIN subscriptions sub ON sub.feed_id = e.feed_id
    WHERE sub.user_id = ? AND sub.is_archived = 0 ${sinceClause}
    ORDER BY COALESCE(e.published_at, e.created_at) DESC
    LIMIT ?
  `).bind(...args).all<Entry>();
  return result.results;
}

export async function listEntryStateForUser(db: D1Database, userId: string, since?: UnixMs): Promise<EntryUserState[]> {
  const sinceClause = since === undefined ? '' : 'AND updated_at > ?';
  const args = since === undefined ? [userId] : [userId, since];
  const result = await db.prepare(`
    SELECT user_id, entry_id, read_at, saved_at, archived_at, last_opened_at, updated_at
    FROM entry_user_state
    WHERE user_id = ? ${sinceClause}
    ORDER BY updated_at ASC
  `).bind(...args).all<EntryUserState>();
  return result.results;
}

export async function listSubscriptionFeedExports(db: D1Database, userId: string): Promise<SubscriptionFeedExport[]> {
  const result = await db.prepare(`
    SELECT f.title, f.canonical_feed_url, f.site_url, sub.folder
    FROM subscriptions sub
    JOIN feeds f ON f.id = sub.feed_id
    WHERE sub.user_id = ? AND sub.is_archived = 0
    ORDER BY sub.sort_order ASC, sub.created_at ASC
  `).bind(userId).all<SubscriptionFeedExport>();
  return result.results;
}

export async function upsertEntry(db: D1Database, entry: NewEntry): Promise<void> {
  await db.prepare(`
    INSERT INTO entries (
      id, feed_id, stable_external_id, canonical_url, title, author, published_at, updated_at_feed,
      summary_text, content_text, content_html_sanitized, content_html_raw, has_remote_images,
      content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(feed_id, stable_external_id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      title = excluded.title,
      author = excluded.author,
      published_at = excluded.published_at,
      updated_at_feed = excluded.updated_at_feed,
      summary_text = excluded.summary_text,
      content_text = excluded.content_text,
      content_html_sanitized = excluded.content_html_sanitized,
      content_html_raw = excluded.content_html_raw,
      has_remote_images = excluded.has_remote_images,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at
  `).bind(
    entry.id,
    entry.feed_id,
    entry.stable_external_id,
    entry.canonical_url,
    entry.title,
    entry.author,
    entry.published_at,
    entry.updated_at_feed,
    entry.summary_text,
    entry.content_text,
    entry.content_html_sanitized,
    entry.content_html_raw,
    entry.has_remote_images,
    entry.content_hash,
    entry.created_at,
    entry.updated_at
  ).run();
}

export async function listTodayEntries(db: D1Database, userId: string, limit = 25, cursorPublishedAt?: UnixMs): Promise<EntryWithState[]> {
  const cursorClause = cursorPublishedAt === undefined ? '' : 'AND COALESCE(e.published_at, e.created_at) < ?';
  const params: unknown[] = [userId];
  if (cursorPublishedAt !== undefined) params.push(cursorPublishedAt);
  params.push(limit);
  const result = await db.prepare(`
    SELECT e.*, f.title AS source_title, s.read_at, s.saved_at, s.archived_at, s.last_opened_at
    FROM entries e
    JOIN feeds f ON f.id = e.feed_id
    JOIN subscriptions sub ON sub.feed_id = e.feed_id AND sub.user_id = ? AND sub.is_archived = 0
    LEFT JOIN entry_user_state s ON s.entry_id = e.id AND s.user_id = sub.user_id
    WHERE s.archived_at IS NULL AND s.read_at IS NULL ${cursorClause}
    ORDER BY COALESCE(e.published_at, e.created_at) DESC
    LIMIT ?
  `).bind(...params).all<EntryWithState>();
  return result.results;
}

export async function getEntryForUser(db: D1Database, userId: string, entryId: string): Promise<EntryWithState | null> {
  return db.prepare(`
    SELECT e.*, f.title AS source_title, s.read_at, s.saved_at, s.archived_at, s.last_opened_at
    FROM entries e
    JOIN feeds f ON f.id = e.feed_id
    JOIN subscriptions sub ON sub.feed_id = e.feed_id AND sub.user_id = ? AND sub.is_archived = 0
    LEFT JOIN entry_user_state s ON s.entry_id = e.id AND s.user_id = sub.user_id
    WHERE e.id = ?
  `).bind(userId, entryId).first<EntryWithState>();
}

export async function searchEntries(db: D1Database, userId: string, query: string, limit = 25): Promise<EntryWithState[]> {
  const candidateLimit = Math.max(100, Math.min(500, limit * 20));
  const result = await db.prepare(`
    SELECT e.*, f.title AS source_title, s.read_at, s.saved_at, s.archived_at, s.last_opened_at
    FROM entries e
    JOIN feeds f ON f.id = e.feed_id
    JOIN subscriptions sub ON sub.feed_id = e.feed_id AND sub.user_id = ? AND sub.is_archived = 0
    LEFT JOIN entry_user_state s ON s.entry_id = e.id AND s.user_id = sub.user_id
    WHERE s.archived_at IS NULL
    ORDER BY COALESCE(e.published_at, e.created_at) DESC
    LIMIT ?
  `).bind(userId, candidateLimit).all<EntryWithState>();
  return result.results
    .map((entry) => ({ entry, rank: rankSearchEntry(entry, query) }))
    .filter((result): result is { entry: EntryWithState; rank: NonNullable<ReturnType<typeof rankSearchEntry>> } => result.rank !== null)
    .sort(compareRankedEntries)
    .slice(0, limit)
    .map((result) => result.entry);
}

export async function patchEntryState(db: D1Database, userId: string, entryId: string, patch: EntryStatePatch, now: UnixMs): Promise<EntryUserState> {
  const existing = await db.prepare(`
    SELECT user_id, entry_id, read_at, saved_at, archived_at, last_opened_at, updated_at
    FROM entry_user_state
    WHERE user_id = ? AND entry_id = ?
  `).bind(userId, entryId).first<EntryUserState>();
  if (existing && patch.updated_at_client < existing.updated_at) return existing;

  const updatedAt = Math.max(now, patch.updated_at_client);
  const readAt = patch.read === undefined ? null : patch.read ? updatedAt : null;
  const savedAt = patch.saved === undefined ? null : patch.saved ? updatedAt : null;
  const archivedAt = patch.archived === undefined ? null : patch.archived ? updatedAt : null;
  await db.prepare(`
    INSERT INTO entry_user_state (user_id, entry_id, read_at, saved_at, archived_at, last_opened_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(user_id, entry_id) DO UPDATE SET
      read_at = CASE WHEN ? THEN excluded.read_at ELSE entry_user_state.read_at END,
      saved_at = CASE WHEN ? THEN excluded.saved_at ELSE entry_user_state.saved_at END,
      archived_at = CASE WHEN ? THEN excluded.archived_at ELSE entry_user_state.archived_at END,
      updated_at = excluded.updated_at
  `).bind(
    userId,
    entryId,
    readAt,
    savedAt,
    archivedAt,
    updatedAt,
    patch.read !== undefined ? 1 : 0,
    patch.saved !== undefined ? 1 : 0,
    patch.archived !== undefined ? 1 : 0
  ).run();
  const state = await db.prepare(`
    SELECT user_id, entry_id, read_at, saved_at, archived_at, last_opened_at, updated_at
    FROM entry_user_state
    WHERE user_id = ? AND entry_id = ?
  `).bind(userId, entryId).first<EntryUserState>();
  if (!state) throw new Error('entry_state_missing_after_patch');
  return state;
}

export async function recordFetchRun(db: D1Database, run: NewFetchRun): Promise<void> {
  await db.prepare(`
    INSERT INTO feed_fetch_runs (id, feed_id, started_at, finished_at, status, http_status, bytes_received, error_code, error_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    run.id,
    run.feed_id,
    run.started_at,
    run.finished_at,
    run.status,
    run.http_status,
    run.bytes_received,
    run.error_code,
    run.error_detail
  ).run();
}

export async function getFeedById(db: D1Database, feedId: string): Promise<Feed | null> {
  return db.prepare(`
    SELECT id, canonical_feed_url, site_url, discovered_from_url, feed_type, title, description,
      language, etag, last_modified, icon_url, updated_at, created_at
    FROM feeds
    WHERE id = ?
  `).bind(feedId).first<Feed>();
}

export async function updateFeedFetchMetadata(
  db: D1Database,
  feedId: string,
  metadata: { title?: string | null; description?: string | null; language?: string | null; site_url?: string | null; etag?: string | null; last_modified?: string | null; updated_at: UnixMs }
): Promise<void> {
  await db.prepare(`
    UPDATE feeds
    SET title = COALESCE(?, title),
      description = COALESCE(?, description),
      language = COALESCE(?, language),
      site_url = COALESCE(?, site_url),
      etag = ?,
      last_modified = ?,
      updated_at = ?
    WHERE id = ?
  `).bind(
    metadata.title ?? null,
    metadata.description ?? null,
    metadata.language ?? null,
    metadata.site_url ?? null,
    metadata.etag ?? null,
    metadata.last_modified ?? null,
    metadata.updated_at,
    feedId
  ).run();
}

export async function updateRefreshQueueState(
  db: D1Database,
  feedId: string,
  state: { next_poll_at: UnixMs; last_polled_at: UnixMs; last_success_at: UnixMs | null; failure_count: number }
): Promise<void> {
  await db.prepare(`
    INSERT INTO feed_refresh_queue_state (feed_id, next_poll_at, last_polled_at, last_success_at, failure_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET
      next_poll_at = excluded.next_poll_at,
      last_polled_at = excluded.last_polled_at,
      last_success_at = excluded.last_success_at,
      failure_count = excluded.failure_count
  `).bind(feedId, state.next_poll_at, state.last_polled_at, state.last_success_at, state.failure_count).run();
}

export async function listDueFeedIds(db: D1Database, now: UnixMs, limit = 50): Promise<string[]> {
  const result = await db.prepare(`
    SELECT q.feed_id
    FROM feed_refresh_queue_state q
    WHERE q.next_poll_at <= ?
      AND EXISTS (
        SELECT 1
        FROM subscriptions s
        WHERE s.feed_id = q.feed_id AND s.is_archived = 0
      )
    ORDER BY q.next_poll_at ASC
    LIMIT ?
  `).bind(now, limit).all<{ feed_id: string }>();
  return result.results.map((row) => row.feed_id);
}
