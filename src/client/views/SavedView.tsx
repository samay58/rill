import type { ReadingEntry } from './EntryListRow';
import { EntryListRow } from './EntryListRow';

interface SavedViewProps {
  entries: ReadingEntry[];
  onOpenEntry: (entryId: string) => void;
}

export function SavedView({ entries, onOpenEntry }: SavedViewProps) {
  const savedEntries = entries
    .filter((entry) => entry.saved_at !== null && entry.archived_at === null)
    .sort((left, right) => (right.saved_at ?? 0) - (left.saved_at ?? 0) || (right.published_at ?? right.created_at) - (left.published_at ?? left.created_at));

  return (
    <section className="today-surface saved-surface" aria-labelledby="saved-title">
      <header className="content-header today-header">
        <div className="desktop-title-group">
          <h1 id="saved-title">Saved</h1>
          <p>{savedEntries.length} saved</p>
        </div>
        <div className="mobile-title-group">
          <h1>Saved</h1>
          <p>{savedEntries.length} saved</p>
        </div>
      </header>
      <div className="entry-list" aria-label="Saved entries">
        {savedEntries.length > 0 ? <p className="day-label">Saved</p> : null}
        {savedEntries.map((entry) => <EntryListRow key={entry.id} entry={entry} onOpenEntry={onOpenEntry} />)}
        {savedEntries.length === 0 ? (
          <div className="caught-up-state empty-list-state">
            <span />
            <p>No saved entries yet</p>
            <span />
          </div>
        ) : null}
      </div>
    </section>
  );
}
