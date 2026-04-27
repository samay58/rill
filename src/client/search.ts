import { compareRankedEntries, rankSearchEntry } from '../shared/entryText';
import type { Entry, Feed } from '../shared/types';
import type { LocalStore } from './db';

export interface LocalSearchResult {
  entry: Entry;
  sourceTitle: string | null;
}

export async function searchLocalEntries(store: LocalStore, query: string, limit = 50): Promise<LocalSearchResult[]> {
  const [entries, feeds] = await Promise.all([
    store.getAll<Entry>('entries'),
    store.getAll<Feed>('feeds')
  ]);
  const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));
  return entries
    .map((entry) => ({ entry, rank: rankSearchEntry(entry, query, feedsById.get(entry.feed_id)?.title ?? null) }))
    .filter((result): result is { entry: Entry; rank: NonNullable<ReturnType<typeof rankSearchEntry>> } => result.rank !== null)
    .sort(compareRankedEntries)
    .slice(0, limit)
    .map(({ entry }) => ({ entry, sourceTitle: feedsById.get(entry.feed_id)?.title ?? null }));
}
