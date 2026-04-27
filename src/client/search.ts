import type { Entry, Feed } from '../shared/types';
import type { LocalStore } from './db';

export interface LocalSearchResult {
  entry: Entry;
  sourceTitle: string | null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function haystackFor(entry: Entry, source: Feed | undefined): string {
  return normalize([
    source?.title,
    entry.title,
    entry.author,
    entry.summary_text,
    entry.content_text
  ].filter(Boolean).join(' '));
}

export async function searchLocalEntries(store: LocalStore, query: string, limit = 50): Promise<LocalSearchResult[]> {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const [entries, feeds] = await Promise.all([
    store.getAll<Entry>('entries'),
    store.getAll<Feed>('feeds')
  ]);
  const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));
  return entries
    .filter((entry) => {
      const haystack = haystackFor(entry, feedsById.get(entry.feed_id));
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((left, right) => (right.published_at ?? right.created_at) - (left.published_at ?? left.created_at))
    .slice(0, limit)
    .map((entry) => ({ entry, sourceTitle: feedsById.get(entry.feed_id)?.title ?? null }));
}
