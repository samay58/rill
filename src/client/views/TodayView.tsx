import type { EntryWithState } from '../../shared/types';
import { RefreshIcon, SearchIcon } from './Shell';
import { EntryListRow } from './EntryListRow';

export type ReadingEntry = EntryWithState;

interface TodayViewProps {
  entries: ReadingEntry[];
  onOpenEntry: (entryId: string) => void;
  onSearch?: () => void;
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
  limit?: number;
}

function formatTodayDate(): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}

export function TodayView({ entries, onOpenEntry, onSearch, onRefresh, isRefreshing = false, limit = 25 }: TodayViewProps) {
  const visibleEntries = entries
    .filter((entry) => entry.read_at === null && entry.archived_at === null)
    .sort((left, right) => (right.published_at ?? right.created_at) - (left.published_at ?? left.created_at))
    .slice(0, limit);
  const unreadCount = entries.filter((entry) => entry.read_at === null && entry.archived_at === null).length;

  return (
    <section className="today-surface" aria-labelledby="today-title">
      <header className="content-header today-header">
        <div className="desktop-title-group">
          <h1 id="today-title">Today</h1>
          <p>{formatTodayDate()}</p>
        </div>
        <div className="mobile-title-group">
          <h1>Today</h1>
          <p>{unreadCount} unread</p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button mobile-only" aria-label="Search" onClick={onSearch}><SearchIcon /></button>
          <button type="button" className="icon-button" aria-label="Refresh" aria-busy={isRefreshing} disabled={isRefreshing} onClick={() => { void onRefresh?.(); }}><RefreshIcon /></button>
        </div>
      </header>
      <div className="entry-list" aria-label="Today entries">
        {visibleEntries.length > 0 ? <p className="day-label">Today</p> : null}
        {visibleEntries.map((entry) => <EntryListRow key={entry.id} entry={entry} onOpenEntry={onOpenEntry} />)}
        <div className="caught-up-state">
          <span />
          <p>Caught up for now</p>
          <span />
        </div>
      </div>
    </section>
  );
}
