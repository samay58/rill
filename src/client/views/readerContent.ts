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

export function canLoadFullArticle(entry: Pick<ReadingEntry, 'canonical_url' | 'content_html_sanitized' | 'content_text' | 'summary_text'>): boolean {
  return Boolean(entry.canonical_url) && !isVideo(entry.canonical_url!) && readerTextLength(entry) < FULL_ARTICLE_THRESHOLD;
}
