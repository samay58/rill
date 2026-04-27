import type { EntryWithState } from '../../shared/types';
import { entryExcerpt } from './entryExcerpt';

export type ReadingEntry = EntryWithState;

function SavedStar() {
  return (
    <svg className="saved-star" viewBox="0 0 16 16" aria-label="Saved">
      <path d="m8 1.8 1.7 3.6 3.9.5-2.9 2.7.8 3.8L8 10.5l-3.5 1.9.8-3.8-2.9-2.7 3.9-.5z" />
    </svg>
  );
}

function displayTime(entry: ReadingEntry): string {
  const timestamp = entry.published_at ?? entry.created_at;
  if (!timestamp) return 'Today';
  const hours = Math.max(1, Math.round((Date.now() - timestamp) / (60 * 60 * 1000)));
  if (hours < 24) return `${hours}h`;
  return 'Yesterday';
}

interface EntryListRowProps {
  entry: ReadingEntry;
  onOpenEntry: (entryId: string) => void;
}

export function EntryListRow({ entry, onOpenEntry }: EntryListRowProps) {
  const isRead = entry.read_at !== null;
  const excerpt = entryExcerpt(entry);
  return (
    <article className={`entry-row ${isRead ? 'is-read' : 'is-unread'}`} data-entry-id={entry.id} data-state={isRead ? 'read' : 'unread'}>
      <span className="entry-dot" aria-hidden="true" />
      <button type="button" className="entry-open-button" onClick={() => onOpenEntry(entry.id)}>
        <div className="entry-body">
          <div className="entry-meta">
            <span>{entry.source_title ?? 'Unknown Source'}</span>
            <span>{displayTime(entry)}</span>
            {entry.saved_at ? <SavedStar /> : null}
          </div>
          <h2>{entry.title ?? 'Untitled'}</h2>
          {excerpt ? <p className="entry-excerpt">{excerpt}</p> : null}
        </div>
      </button>
    </article>
  );
}
