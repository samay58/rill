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

export function canLoadFullArticle(entry: Pick<ReadingEntry, 'canonical_url' | 'content_html_sanitized' | 'content_text' | 'summary_text'>): boolean {
  return Boolean(entry.canonical_url) && readerTextLength(entry) < FULL_ARTICLE_THRESHOLD;
}
