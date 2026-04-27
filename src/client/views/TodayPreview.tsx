import { sampleEntries, SampleEntry, unreadCount, yesterdayEntries } from '../design';
import { RefreshIcon, SearchIcon } from './Shell';

function SavedStar() {
  return (
    <svg className="saved-star" viewBox="0 0 16 16" aria-label="Saved">
      <path d="m8 1.8 1.7 3.6 3.9.5-2.9 2.7.8 3.8L8 10.5l-3.5 1.9.8-3.8-2.9-2.7 3.9-.5z" />
    </svg>
  );
}

function EntryRow({ entry }: { entry: SampleEntry }) {
  return (
    <article className={`entry-row ${entry.unread ? 'is-unread' : 'is-read'}`} data-state={entry.unread ? 'unread' : 'read'}>
      <span className="entry-dot" aria-hidden="true" />
      <div className="entry-body">
        <div className="entry-meta">
          <span>{entry.source}</span>
          <span>{entry.time}</span>
          {entry.saved ? <SavedStar /> : null}
        </div>
        <h2>{entry.title}</h2>
        <p className="entry-excerpt">{entry.excerpt}</p>
      </div>
    </article>
  );
}

export function TodayPreview() {
  return (
    <section className="today-surface" aria-labelledby="today-title">
      <header className="content-header today-header">
        <div className="desktop-title-group">
          <h1 id="today-title">Today</h1>
          <p>Sunday, April 27</p>
        </div>
        <div className="mobile-title-group">
          <h1>Today</h1>
          <p>{unreadCount()} unread</p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button mobile-only" aria-label="Search"><SearchIcon /></button>
          <button type="button" className="icon-button" aria-label="Refresh"><RefreshIcon /></button>
        </div>
      </header>
      <div className="entry-list" aria-label="Today entries">
        <p className="day-label">Today</p>
        {sampleEntries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
        <p className="day-label older-label">Yesterday</p>
        {yesterdayEntries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
        <div className="more-footer"><span />25 more from the past week<span /></div>
      </div>
    </section>
  );
}
