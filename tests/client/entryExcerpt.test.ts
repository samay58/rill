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

  it('turns Techmeme-style HTML blurbs into a short human preview', () => {
    const title = 'Filing: Beijing-based GPU maker Moore Threads reports Q1 revenue up 155% YoY to ~$107.89M, and a $4.3M net profit, up from a ~$16.46M net loss in Q1 2025 (Iris Deng/South China Morning Post)';
    const excerpt = entryExcerpt(entry({
      title,
      source_title: 'Techmeme',
      summary_text: '<A HREF="https://www.scmp.com/tech/article/3351492/moore-threads-posts-us43m-profit-nvidia-rival-surges-amid-beijing-chip-push"><IMG VSPACE="4" HSPACE="4" BORDER="0" ALIGN="RIGHT" SRC="http://www.techmeme.com/260427/i3.jpg"></A> <P><A HREF="http://www.techmeme.com/260427/p3#a260427p3" TITLE="Techmeme permalink"><IMG WIDTH=11 HEIGHT=12 SRC="http://www.techmeme.com/img/pml.png" STYLE="border:none;padding:0;margin:0;"></A> Iris Deng / <A HREF="http://www.scmp.com/">South China Morning Post</A>:<BR> <SPAN STYLE="font-size:1.3em;"><B><A HREF="https://www.scmp.com/tech/article/3351492/moore-threads-posts-us43m-profit-nvidia-rival-surges-amid-beijing-chip-push">Filing: Beijing-based GPU maker Moore Threads reports Q1 revenue up 155% YoY to ~$107.89M, and a $4.3M net profit, up from a ~$16.46M net loss in Q1 2025</A></B></SPAN>&nbsp; &mdash;&nbsp; Beijing-based GPU maker turns a corner in the first quarter of 2026 after posting a US$16.5 million loss a year earlier</P>'
    }));

    expect(excerpt).toBe('Beijing-based GPU maker turns a corner in the first quarter of 2026 after posting a US$16.5 million loss a year earlier');
    expect(excerpt).not.toContain('<A HREF');
    expect(excerpt).not.toContain('IMG');
    expect(excerpt).not.toContain('http');
    expect(excerpt).not.toContain(title.slice(0, 40));
  });

  it('falls back to content text when a summary is missing', () => {
    expect(entryExcerpt(entry({ content_text: 'A useful body fallback.' }))).toBe('A useful body fallback.');
  });
});
