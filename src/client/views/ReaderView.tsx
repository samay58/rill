import { useState } from 'react';
import type { ReadingEntry } from './TodayView';
import { canLoadFullArticle } from './readerContent';

interface ReaderViewProps {
  entry: ReadingEntry;
  onBack: () => void;
  backLabel?: string;
  onSave: (entryId: string) => void;
  onArchive: (entryId: string) => void;
  onMarkUnread: (entryId: string) => void;
  onLoadFullArticle?: (entryId: string) => void;
  isLoadingFullArticle?: boolean;
  fullArticleError?: string;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return 'Undated';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp));
}

function parseHtml(html: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
}

function remoteImageCount(html: string | null): number {
  if (!html) return 0;
  const parsed = parseHtml(html);
  if (!parsed) return (html.match(/<img\b[^>]*src=["']https?:\/\//gi) ?? []).length;
  return parsed.querySelectorAll('img[src^="http://"], img[src^="https://"]').length;
}

function htmlWithoutImages(html: string): string {
  const parsed = parseHtml(html);
  if (!parsed) return html.replace(/<(img|source|video|audio|track)\b[^>]*>(?:<\/\1>)?/gi, '');
  parsed.querySelectorAll('img, source, video, audio, track').forEach((node) => node.remove());
  return parsed.querySelector('main')?.innerHTML ?? '';
}

function htmlWithProxiedImages(html: string, entryId: string): string {
  const parsed = parseHtml(html);
  if (!parsed) return htmlWithoutImages(html);
  parsed.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const source = image.getAttribute('src') ?? '';
    if (!/^https?:\/\//i.test(source)) {
      image.remove();
      return;
    }
    image.setAttribute('src', `/api/image?entry_id=${encodeURIComponent(entryId)}&src=${encodeURIComponent(source)}`);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
  });
  parsed.querySelectorAll('source, video, audio, track').forEach((node) => node.remove());
  return parsed.querySelector('main')?.innerHTML ?? '';
}

function textParagraphs(text: string | null): string[] {
  return (text ?? '').split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function ReaderView({ entry, onBack, backLabel = 'Today', onSave, onArchive, onMarkUnread, onLoadFullArticle, isLoadingFullArticle = false, fullArticleError }: ReaderViewProps) {
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const hiddenImages = Math.max(remoteImageCount(entry.content_html_sanitized), entry.has_remote_images ? 1 : 0);
  const canExtractArticle = canLoadFullArticle(entry);
  const safeHtml = entry.content_html_sanitized
    ? imagesLoaded ? htmlWithProxiedImages(entry.content_html_sanitized, entry.id) : htmlWithoutImages(entry.content_html_sanitized)
    : null;
  const paragraphs = safeHtml ? [] : textParagraphs(entry.content_text ?? entry.summary_text);
  const byline = [entry.source_title, entry.author, formatDate(entry.published_at ?? entry.created_at)].filter(Boolean).join(' · ');

  return (
    <section className="reader-surface" aria-labelledby="reader-title">
      <header className="reader-topbar">
        <button type="button" className="reader-back" data-action="back-to-today" onClick={onBack}><span aria-hidden="true">‹ </span>{backLabel}</button>
        <div className="reader-toolbar" aria-label="Entry actions">
          <button type="button" className="reader-save" data-action="save-entry" onClick={() => onSave(entry.id)}>{entry.saved_at ? 'Saved' : <>Save<span className="wide-only"> for later</span></>}</button>
          <button type="button" data-action="archive-entry" onClick={() => onArchive(entry.id)}>Archive</button>
          <button type="button" data-action="mark-unread" onClick={() => onMarkUnread(entry.id)}>Mark unread</button>
          <span aria-hidden="true" />
          {entry.canonical_url ? <a data-action="open-original" href={entry.canonical_url} target="_blank" rel="noreferrer"><span className="wide-only">Open </span>Original<span aria-hidden="true">{"\u00a0↗"}</span></a> : null}
        </div>
      </header>
      <article className="reader-article">
        <p className="reader-byline">{byline}</p>
        <h1 id="reader-title">{entry.title ?? 'Untitled'}</h1>
        {entry.saved_at ? <p className="reader-state-note">Saved to Saved</p> : null}
        {canExtractArticle ? (
          <div className="reader-extraction-banner">
            <p>{fullArticleError ?? 'This feed only provided a short preview.'}</p>
            <button
              type="button"
              data-action="load-full-article"
              disabled={isLoadingFullArticle}
              aria-busy={isLoadingFullArticle}
              onClick={() => onLoadFullArticle?.(entry.id)}
            >
              {isLoadingFullArticle ? 'Loading article' : 'Load full article'}
            </button>
          </div>
        ) : null}
        {hiddenImages > 0 && !imagesLoaded ? (
          <div className="hidden-images-banner">
            <span aria-hidden="true">▧</span>
            <p>{hiddenImages} remote image{hiddenImages === 1 ? '' : 's'} hidden</p>
            <button type="button" data-action="load-entry-images" onClick={() => setImagesLoaded(true)}>Load for this entry</button>
          </div>
        ) : null}
        {safeHtml ? <div className="reader-body" dangerouslySetInnerHTML={{ __html: safeHtml }} /> : null}
        {!safeHtml ? (
          <div className="reader-body">
            {paragraphs.length > 0 ? paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>) : <p>No feed content was provided for this entry.</p>}
          </div>
        ) : null}
      </article>
    </section>
  );
}
