import { describe, expect, it } from 'vitest';
import { canLoadFullArticle, readerTextLength } from '../../src/client/views/readerContent';
import type { ReadingEntry } from '../../src/client/views/TodayView';

function entry(overrides: Partial<ReadingEntry> = {}): ReadingEntry {
  return {
    id: 'entry-1',
    feed_id: 'feed-1',
    stable_external_id: 'entry-1',
    canonical_url: 'https://example.com/entry-1',
    title: 'Quiet title',
    author: null,
    published_at: 1,
    updated_at_feed: null,
    summary_text: 'A brief teaser from the feed.',
    content_text: null,
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    source_title: 'Notebook Letters',
    read_at: null,
    saved_at: null,
    archived_at: null,
    last_opened_at: null,
    ...overrides
  };
}

describe('readerContent', () => {
  it('allows loading full articles for short teaser entries with a canonical URL', () => {
    expect(canLoadFullArticle(entry())).toBe(true);
  });

  it('does not allow loading the full article when the canonical URL is missing', () => {
    expect(canLoadFullArticle(entry({ canonical_url: null }))).toBe(false);
  });

  it('does not allow loading when existing HTML content is long enough', () => {
    const fullText = 'This cached article paragraph is already present. '.repeat(24);
    const longEntry = entry({
      content_html_sanitized: `<article><p>${fullText}</p></article>`,
      content_text: 'Short fallback.',
      summary_text: 'Short summary.'
    });

    expect(readerTextLength(longEntry)).toBeGreaterThan(800);
    expect(canLoadFullArticle(longEntry)).toBe(false);
  });
});
