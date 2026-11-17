import { entryContentHash } from '../shared/contentHash';
import type { Entry, Feed } from '../shared/types';

// Newsletters that arrive by email in full while their public feed carries only a teaser (Money Stuff: the
// Bloomberg RSS item is one line, and Bloomberg refuses both extractors). The Mac Mini posts each letter here;
// it either upgrades the matching feed entry in place, so read and saved state stay with it, or lands as a new
// entry in that feed. An upgraded row carries a `letter:` content hash, and migration 0002 keeps the next feed
// poll from writing the teaser back over it.

export const LETTER_HASH_PREFIX = 'letter:';
const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// Case, punctuation and quote style differ between an email subject and its RSS title ("Huang’s" vs "Huang's").
export function normalizeLetterTitle(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function letterContentHash(parts: { title?: string | null; content_text?: string | null; content_html_sanitized?: string | null }): string {
  return `${LETTER_HASH_PREFIX}${entryContentHash(parts)}`;
}

export async function feedByUrl(db: D1Database, url: string): Promise<Feed | null> {
  return db.prepare(`/* letters:feed-by-url */ SELECT * FROM feeds WHERE canonical_feed_url = ?`).bind(url).first<Feed>();
}

export async function isSubscribed(db: D1Database, userId: string, feedId: string): Promise<boolean> {
  const row = await db.prepare(`/* letters:subscribed */ SELECT 1 AS ok FROM subscriptions WHERE user_id = ? AND feed_id = ?`).bind(userId, feedId).first<{ ok: number }>();
  return Boolean(row);
}

export async function entriesNear(db: D1Database, feedId: string, at: number): Promise<Entry[]> {
  const result = await db.prepare(`
    /* letters:entries-near */
    SELECT * FROM entries
    WHERE feed_id = ? AND COALESCE(published_at, created_at) BETWEEN ? AND ?
  `).bind(feedId, at - MATCH_WINDOW_MS, at + MATCH_WINDOW_MS).all<Entry>();
  return result.results;
}

export function matchingEntry(entries: Entry[], title: string): Entry | null {
  const wanted = normalizeLetterTitle(title);
  if (!wanted) return null;
  return entries.find((entry) => normalizeLetterTitle(entry.title) === wanted) ?? null;
}

export interface LetterContent {
  summary_text: string;
  content_text: string;
  content_html_sanitized: string;
  has_remote_images: 0 | 1;
  content_hash: string;
}

export async function upgradeEntryWithLetter(db: D1Database, entryId: string, content: LetterContent, now: number): Promise<void> {
  await db.prepare(`
    /* letters:upgrade */
    UPDATE entries
    SET summary_text = ?, content_text = ?, content_html_sanitized = ?, content_html_raw = NULL,
        has_remote_images = ?, content_hash = ?, updated_at = ?
    WHERE id = ?
  `).bind(content.summary_text, content.content_text, content.content_html_sanitized, content.has_remote_images, content.content_hash, now, entryId).run();
}

// A letter that landed on its own before the feed carried its teaser is folded into the feed entry once the teaser
// appears: the feed entry takes the letter's read and saved state, and the standalone copy is archived rather than
// deleted, since archive state reaches every device through sync and a delete only reaches them at the next bootstrap.
export async function foldStandaloneLetter(db: D1Database, userId: string, standaloneId: string, feedEntryId: string, now: number): Promise<void> {
  const state = await db.prepare(`/* letters:state */ SELECT read_at, saved_at FROM entry_user_state WHERE user_id = ? AND entry_id = ?`)
    .bind(userId, standaloneId).first<{ read_at: number | null; saved_at: number | null }>();
  if (state && (state.read_at !== null || state.saved_at !== null)) {
    await db.prepare(`
      /* letters:carry-state */
      INSERT INTO entry_user_state (user_id, entry_id, read_at, saved_at, archived_at, last_opened_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(user_id, entry_id) DO UPDATE SET
        read_at = COALESCE(entry_user_state.read_at, excluded.read_at),
        saved_at = COALESCE(entry_user_state.saved_at, excluded.saved_at),
        updated_at = excluded.updated_at
    `).bind(userId, feedEntryId, state.read_at, state.saved_at, now).run();
  }
  await db.prepare(`
    /* letters:archive */
    INSERT INTO entry_user_state (user_id, entry_id, read_at, saved_at, archived_at, last_opened_at, updated_at)
    VALUES (?, ?, NULL, NULL, ?, NULL, ?)
    ON CONFLICT(user_id, entry_id) DO UPDATE SET archived_at = COALESCE(entry_user_state.archived_at, excluded.archived_at), updated_at = excluded.updated_at
  `).bind(userId, standaloneId, now, now).run();
}
