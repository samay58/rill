import type { EntryWithState } from '../../shared/types';
import { entryExcerpt } from './entryExcerpt';
import { relativeTime } from './readingDay';

export type ReadingEntry = EntryWithState;

function SavedStar() {
  return (
    <svg className="saved-star" viewBox="0 0 16 16" aria-label="Saved">
      <path d="m8 1.8 1.7 3.6 3.9.5-2.9 2.7.8 3.8L8 10.5l-3.5 1.9.8-3.8-2.9-2.7 3.9-.5z" />
    </svg>
  );
}

interface EntryListRowProps {
  entry: ReadingEntry;
  onOpenEntry: (entryId: string) => void;
  now?: number;
  edition?: boolean;
}

export function EntryListRow({ entry, onOpenEntry, now = Date.now(), edition = false }: EntryListRowProps) {
  const isRead = entry.read_at !== null;
  // The edition's body is a whole front page; its first lines are a masthead, not a preview worth printing.
  const excerpt = edition ? null : entryExcerpt(entry);
  return (
    <article
      className={`entry-row ${isRead ? 'is-read' : 'is-unread'}${edition ? ' is-edition' : ''}`}
      data-entry-id={entry.id}
      data-state={isRead ? 'read' : 'unread'}
    >
      <span className="entry-dot" aria-hidden="true" />
      <button type="button" className="entry-open-button" onClick={() => onOpenEntry(entry.id)}>
        <div className="entry-body">
          <div className="entry-meta">
            <span>{entry.source_title ?? 'Unknown Source'}</span>
            <span>{relativeTime(entry.published_at ?? entry.created_at, now)}</span>
            {isRead ? <span className="visually-hidden">Read</span> : null}
            {entry.saved_at ? <SavedStar /> : null}
          </div>
          <h2>{entry.title ?? 'Untitled'}</h2>
          {excerpt ? <p className="entry-excerpt">{excerpt}</p> : null}
        </div>
      </button>
    </article>
  );
}
