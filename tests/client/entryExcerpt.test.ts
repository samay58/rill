import { describe, expect, it } from 'vitest';
import { entryExcerpt } from '../../src/client/views/entryExcerpt';
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
    summary_text: null,
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

describe('entryExcerpt', () => {
  it('strips raw HTML and attributes from cached feed summaries', () => {
    const excerpt = entryExcerpt(entry({
      summary_text: '<p>Dear followers, <a href="https://example.com">start here</a>.</p><p>Second sentence.</p>'
    }));

    expect(excerpt).toBe('Dear followers, start here. Second sentence.');
    expect(excerpt).not.toContain('<p>');
    expect(excerpt).not.toContain('href=');
  });

  it('truncates long previews at a word boundary', () => {
    const excerpt = entryExcerpt(entry({
      summary_text: 'This is a long preview '.repeat(20)
    }), 90);

    expect(excerpt?.length).toBeLessThanOrEqual(91);
    expect(excerpt?.endsWith('…')).toBe(true);
    expect(excerpt).not.toContain('  ');
  });

  it('hides duplicate or empty preview text', () => {
    expect(entryExcerpt(entry({ title: 'Same text', summary_text: 'Same text' }))).toBeNull();
    expect(entryExcerpt(entry({ summary_text: '<p></p>' }))).toBeNull();
  });

  it('falls back to content text when a summary is missing', () => {
    expect(entryExcerpt(entry({ content_text: 'A useful body fallback.' }))).toBe('A useful body fallback.');
  });
});
