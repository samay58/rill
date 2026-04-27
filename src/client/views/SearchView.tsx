import { useMemo, useState } from 'react';
import { compareRankedEntries, rankSearchEntry } from '../../shared/entryText';
import type { ReadingEntry } from './TodayView';
import { entryExcerpt } from './entryExcerpt';

interface SearchViewProps {
  entries: ReadingEntry[];
  onOpenEntry: (entryId: string) => void;
}
export function SearchView({ entries, onOpenEntry }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => entries
    .filter((entry) => entry.archived_at === null)
    .map((entry) => ({ entry, rank: rankSearchEntry(entry, query) }))
    .filter((result): result is { entry: ReadingEntry; rank: NonNullable<ReturnType<typeof rankSearchEntry>> } => result.rank !== null)
    .sort(compareRankedEntries)
    .slice(0, 50)
    .map((result) => result.entry), [entries, query]);

  return (
    <section className="add-source-surface search-surface" aria-labelledby="search-heading">
      <div className="narrow-panel">
        <p className="section-kicker">Search</p>
        <h1 id="search-heading">Search cached entries.</h1>
        <p className="quiet-copy">Search runs locally across synced titles, sources, authors, summaries, and cached text.</p>
        <input className="search-input" aria-label="Search entries" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search entries" />
        <div className="search-results" aria-live="polite">
          {query.trim() && results.length === 0 ? <p className="empty-copy">No cached entries match that search.</p> : null}
          {results.map((entry) => {
            const excerpt = entryExcerpt(entry);
            return (
              <button key={entry.id} type="button" className="search-result" onClick={() => onOpenEntry(entry.id)}>
                <span>{entry.source_title ?? 'Unknown source'}</span>
                <strong>{entry.title ?? 'Untitled'}</strong>
                {excerpt ? <small>{excerpt}</small> : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
