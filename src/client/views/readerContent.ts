import type { ReadingEntry } from './TodayView';

const FULL_ARTICLE_THRESHOLD = 800;

function normalize(value: string | null): string {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function readerTextLength(entry: Pick<ReadingEntry, 'content_html_sanitized' | 'content_text' | 'summary_text'>): number {
  const htmlLength = normalize(entry.content_html_sanitized).length;
  const textLength = normalize(entry.content_text ?? entry.summary_text).length;
  return Math.max(htmlLength, textLength);
}

// A video's page is not an article; fetching it returns player chrome.
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/i;

function isVideo(url: string): boolean {
  try { return VIDEO_HOSTS.test(new URL(url).hostname); } catch { return false; }
}

// A short preview: the feed carried a teaser, so the reader fetches the piece and says so if the site refuses.
export function isTeaser(entry: Pick<ReadingEntry, 'content_html_sanitized' | 'content_text' | 'summary_text'>): boolean {
  return readerTextLength(entry) < FULL_ARTICLE_THRESHOLD;
}

// Text with no markup and no paragraph breaks renders as one wall (14 of his 100 entries on Nov 16 2026, mostly
// Simon Willison's). The page itself has the paragraphs, links and code, so it is fetched the same way, quietly.
export function isUnstructured(entry: Pick<ReadingEntry, 'content_html_sanitized' | 'content_text' | 'summary_text'>): boolean {
  const text = entry.content_text ?? entry.summary_text ?? '';
  return !entry.content_html_sanitized && text.length >= FULL_ARTICLE_THRESHOLD && !/\n\s*\n/.test(text);
}

export function canLoadFullArticle(entry: Pick<ReadingEntry, 'canonical_url' | 'content_html_sanitized' | 'content_text' | 'summary_text'>): boolean {
  return Boolean(entry.canonical_url) && !isVideo(entry.canonical_url!) && (isTeaser(entry) || isUnstructured(entry));
}
