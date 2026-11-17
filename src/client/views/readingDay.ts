import type { EntryWithState } from '../../shared/types';

// The edition is stored as one more source whose feed URL ends in /edition (src/worker/routes/ingest.ts).
export const EDITION_FEED_SUFFIX = '/edition';
export const EDITION_PIN_MS = 48 * 60 * 60 * 1000;

export function isEdition(entry: Pick<EntryWithState, 'feed_id'>): boolean {
  return entry.feed_id.endsWith(EDITION_FEED_SUFFIX);
}

export function startOfLocalDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// "3h" inside a day, the weekday inside a week, then the date. Before Nov 16 2026 anything older than a day
// read "Yesterday", including last week's posts.
export function relativeTime(timestamp: number | null | undefined, now: number): string {
  if (!timestamp) return '';
  const elapsed = now - timestamp;
  if (elapsed < 60 * 60 * 1000) return `${Math.max(1, Math.round(elapsed / 60000))}m`;
  if (elapsed < 24 * 60 * 60 * 1000) return `${Math.round(elapsed / (60 * 60 * 1000))}h`;
  const date = new Date(timestamp);
  if (timestamp >= startOfLocalDay(now) - 24 * 60 * 60 * 1000) return 'Yesterday';
  if (elapsed < 6 * 24 * 60 * 60 * 1000) return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}
