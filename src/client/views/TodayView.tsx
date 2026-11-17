import type { EntryWithState } from '../../shared/types';
import { RefreshIcon, SearchIcon } from './Shell';
import { EntryListRow } from './EntryListRow';
import { EDITION_PIN_MS, isEdition, startOfLocalDay } from './readingDay';

export type ReadingEntry = EntryWithState;

interface TodayViewProps {
  entries: ReadingEntry[];
  onOpenEntry: (entryId: string) => void;
  onSearch?: () => void;
  onRefresh?: () => void | Promise<void>;
  isRefreshing?: boolean;
  limit?: number;
  now?: number;
}

function formatTodayDate(now: number): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(now));
}

function timestampOf(entry: ReadingEntry): number {
  return entry.published_at ?? entry.created_at;
}

// The newest Morning Edition stays at the top until the next one arrives, read or not: it is the day's front page,
// and he goes back to it between stories. An edition older than two days is a stalled job, not today's paper.
function pinnedEdition(entries: ReadingEntry[], now: number): ReadingEntry | null {
  const editions = entries.filter((entry) => isEdition(entry) && entry.archived_at === null);
  if (editions.length === 0) return null;
  const newest = editions.reduce((best, entry) => (timestampOf(entry) > timestampOf(best) ? entry : best));
  return now - timestampOf(newest) <= EDITION_PIN_MS ? newest : null;
}

function groupLabel(timestamp: number, now: number): string {
  const today = startOfLocalDay(now);
  if (timestamp >= today) return 'Today';
  if (timestamp >= today - 24 * 60 * 60 * 1000) return 'Yesterday';
  return 'Earlier';
}

export function TodayView({ entries, onOpenEntry, onSearch, onRefresh, isRefreshing = false, limit = 25, now = Date.now() }: TodayViewProps) {
  const edition = pinnedEdition(entries, now);
  const dayStart = startOfLocalDay(now);
  // An entry opened today stays where it was, dimmed, until the day turns over. Before Nov 16 2026 opening an
  // entry removed it at once, so leaving the digest for another page lost it and the only way back was
  // "Mark unread". Read state still means read: the dot goes, the count drops, tomorrow it is gone.
  const listed = entries
    .filter((entry) => entry.id !== edition?.id && entry.archived_at === null)
    .filter((entry) => entry.read_at === null || entry.read_at >= dayStart)
    .sort((left, right) => timestampOf(right) - timestampOf(left));
  const visibleEntries: ReadingEntry[] = [];
  let unreadShown = 0;
  for (const entry of listed) {
    if (entry.read_at === null) {
      if (unreadShown >= limit) continue;
      unreadShown += 1;
    }
    visibleEntries.push(entry);
  }
  const unreadCount = entries.filter((entry) => entry.read_at === null && entry.archived_at === null).length;
  const groups: Array<{ label: string; entries: ReadingEntry[] }> = [];
  for (const entry of visibleEntries) {
    const label = groupLabel(timestampOf(entry), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  return (
    <section className="today-surface" aria-labelledby="today-title">
      <header className="content-header today-header">
        <div className="desktop-title-group">
          <h1 id="today-title">Today</h1>
          <p>{formatTodayDate(now)}</p>
        </div>
        <div className="mobile-title-group">
          <h1>Today</h1>
          <p>{unreadCount === 0 ? 'All read' : `${unreadCount} unread`}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button mobile-only" aria-label="Search" onClick={onSearch}><SearchIcon /></button>
          <button type="button" className="icon-button" aria-label="Refresh" aria-busy={isRefreshing} disabled={isRefreshing} onClick={() => { void onRefresh?.(); }}><RefreshIcon /></button>
        </div>
      </header>
      <div className="entry-list" aria-label="Today entries">
        {edition ? (
          <div className="edition-pin">
            <EntryListRow entry={edition} onOpenEntry={onOpenEntry} now={now} edition />
          </div>
        ) : null}
        {groups.map((group) => (
          <div className="entry-group" key={group.label}>
            <p className={`day-label${group.label === 'Today' ? '' : ' older-label'}`}>{group.label}</p>
            {group.entries.map((entry) => <EntryListRow key={entry.id} entry={entry} onOpenEntry={onOpenEntry} now={now} />)}
          </div>
        ))}
        <div className="caught-up-state">
          <span />
          <p>Caught up for now</p>
          <span />
        </div>
      </div>
    </section>
  );
}
