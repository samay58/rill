import { ChangeEvent, useState } from 'react';
import { RefreshIcon } from './Shell';

export interface SourceViewModel {
  id: string;
  title: string;
  url: string;
  siteUrl: string | null;
  updatedAt: number;
  unreadCount: number;
  isArchived: boolean;
  isRefreshing?: boolean;
}

interface SourcesViewProps {
  sources?: SourceViewModel[];
  onAddSource: () => void;
  onRefreshSource?: (subscriptionId: string) => void;
  onArchiveSource?: (subscriptionId: string, archived: boolean) => void;
  onRemoveSource?: (subscriptionId: string) => void;
  onRefreshAll?: () => void;
  onImportOpml?: (text: string) => Promise<void> | void;
  isRefreshingAll?: boolean;
}

function statusClass(source: SourceViewModel): string {
  if (source.isArchived) return 'source-row is-archived';
  if (source.isRefreshing) return 'source-row is-refreshing';
  return 'source-row is-active';
}

function updatedLabel(updatedAt: number): string {
  if (!updatedAt) return 'Never updated';
  const ageHours = Math.max(0, Math.round((Date.now() - updatedAt) / 3_600_000));
  if (ageHours === 0) return 'Updated just now';
  if (ageHours === 1) return 'Updated 1h ago';
  return `Updated ${ageHours}h ago`;
}

export function SourcesView({ sources = [], onAddSource, onRefreshSource, onArchiveSource, onRemoveSource, onRefreshAll, onImportOpml, isRefreshingAll = false }: SourcesViewProps) {
  const activeCount = sources.filter((source) => !source.isArchived).length;
  const [message, setMessage] = useState<string | null>(null);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file || !onImportOpml) return;
    await onImportOpml(await file.text());
    setMessage(`Imported ${file.name}.`);
    event.currentTarget.value = '';
  }

  return (
    <section className="sources-surface" aria-labelledby="sources-heading">
      <header className="content-header sources-header">
        <h1 id="sources-heading">Sources</h1>
        <div className="source-toolbar">
          <label className="ghost-button import-opml-control">
            Import OPML
            <input type="file" accept=".opml,.xml,text/xml,text/x-opml" aria-label="Import OPML file" onChange={(event) => void handleImport(event)} />
          </label>
          <a className="ghost-button" href="/api/subscriptions/export.opml">Export</a>
          <button type="button" className="accent-button" onClick={onAddSource}>+ Add source</button>
        </div>
      </header>
      <div className="source-list" aria-label="Sources">
        {sources.length === 0 ? <p className="empty-copy">No sources yet. Add one feed to begin.</p> : null}
        {sources.map((source) => (
          <article key={source.id} className={statusClass(source)} data-subscription-id={source.id} data-state={source.isArchived ? 'archived' : source.isRefreshing ? 'refreshing' : 'active'}>
            <span className="source-dot" aria-hidden="true" />
            <div className="source-body">
              <div className="source-title-line">
                <h2>{source.title}</h2>
                <span>{source.url}</span>
                {source.isArchived ? <span className="archived-badge">archived</span> : null}
              </div>
              <p>{source.isRefreshing ? 'Refreshing...' : `${updatedLabel(source.updatedAt)} · ${source.unreadCount} unread`}</p>
            </div>
            <div className="source-actions">
              {!source.isArchived ? <button type="button" className="source-refresh" aria-label={`Refresh ${source.title}`} aria-busy={source.isRefreshing} disabled={source.isRefreshing} onClick={() => onRefreshSource?.(source.id)}><RefreshIcon /></button> : null}
              <button type="button" onClick={() => onArchiveSource?.(source.id, !source.isArchived)}>{source.isArchived ? 'Unarchive' : 'Archive'}</button>
              <button type="button" onClick={() => onRemoveSource?.(source.id)}>Remove</button>
            </div>
          </article>
        ))}
      </div>
      {message ? <p className="success-message source-message">{message}</p> : null}
      <footer className="sources-footer">
        {activeCount} active sources · <button type="button" aria-busy={isRefreshingAll} disabled={isRefreshingAll} onClick={onRefreshAll}>{isRefreshingAll ? 'Refreshing all' : 'Refresh all'}</button>
      </footer>
    </section>
  );
}
