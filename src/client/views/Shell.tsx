import { ReactNode } from 'react';
import { AppView, mobileNavItems, navItems } from '../design';

interface ShellProps {
  activeView: AppView;
  unreadCount: number;
  onNavigate: (view: AppView) => void;
  children: ReactNode;
}

function displayActiveView(view: AppView): AppView {
  return view === 'add-source' ? 'sources' : view;
}

function Icon({ name }: { name: 'grid' | 'bookmark' | 'feed' | 'search' | 'refresh' }) {
  if (name === 'grid') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="4" height="4" rx="1" />
        <rect x="10" y="2" width="4" height="4" rx="1" />
        <rect x="2" y="10" width="4" height="4" rx="1" />
        <rect x="10" y="10" width="4" height="4" rx="1" />
      </svg>
    );
  }
  if (name === 'bookmark') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 2.5h7v11l-3.5-2-3.5 2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'feed') {
    // Sources: the feed mark, a dot and two arcs. It was a clock, which said nothing about sources.
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="4" cy="12" r="1.5" />
        <path d="M2.8 7.3a6 6 0 0 1 5.9 5.9M2.8 3a10.2 10.2 0 0 1 10.2 10.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'search') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'refresh') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M12.8 5.3A5 5 0 1 1 11 3.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12.9 2.3v3.1H9.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

function NavButton({ item, active, unreadCount, onNavigate }: { item: (typeof navItems)[number]; active: boolean; unreadCount: number; onNavigate: (view: AppView) => void }) {
  return (
    <button type="button" className={`side-nav-item ${active ? 'is-active' : ''}`} aria-label={item.label} onClick={() => onNavigate(item.view)}>
      <span className="nav-icon"><Icon name={item.icon} /></span>
      <span>{item.label}</span>
      {item.view === 'today' && unreadCount > 0 ? <span className="unread-badge">{unreadCount}</span> : null}
    </button>
  );
}

export function RefreshIcon() {
  return <Icon name="refresh" />;
}

export function SearchIcon() {
  return <Icon name="search" />;
}

export function Shell({ activeView, unreadCount, onNavigate, children }: ShellProps) {
  const active = displayActiveView(activeView);
  return (
    <div className="notebook-shell">
      <aside className="sidebar" aria-label="Rill navigation">
        <div className="sidebar-brand">
          <img className="sidebar-brand-icon" src="/icons/rill-icon-48.png" alt="" aria-hidden="true" />
          <div className="wordmark">rill</div>
        </div>
        <nav className="side-nav">
          {navItems.map((item) => (
            <NavButton key={item.view} item={item} active={active === item.view} unreadCount={unreadCount} onNavigate={onNavigate} />
          ))}
        </nav>
      </aside>
      <div className="notebook-content">{children}</div>
      <nav className="mobile-tabbar" aria-label="Rill mobile sections">
        {mobileNavItems.map((item) => (
          <button key={item.view} type="button" className={`mobile-tab ${active === item.view ? 'is-active' : ''}`} onClick={() => onNavigate(item.view)}>
            <span className="nav-icon"><Icon name={item.icon} /></span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
