import { describe, expect, it } from 'vitest';
import { cleanLine, distinctAuthor } from '../../src/shared/displayText';
import { entryPreviewText, withoutFeedFooterHtml } from '../../src/shared/entryText';
import { parseFeed } from '../../src/shared/feed/parse';
import { sanitizeFeedHtml } from '../../src/shared/feed/sanitize';

// Each case is a title or preview seen in the live feed list on Nov 17 2026.
describe('feed text on screen', () => {
  it('decodes numeric, named and double-escaped entities in titles', () => {
    expect(cleanLine('Ben Shelton&#8217;s Pliable Ceiling')).toBe('Ben Shelton’s Pliable Ceiling');
    expect(cleanLine('Amazon&#39;s Durability')).toBe('Amazon’s Durability');
    expect(cleanLine('Songs from the Commons: A Q&amp;A')).toBe('Songs from the Commons: A Q&A');
    expect(cleanLine('It&amp;#8217;s Coachella For Tennis')).toBe('It’s Coachella For Tennis');
  });

  it('leaves bare ampersands and angle-bracket text alone', () => {
    expect(cleanLine('AT&T and R&D')).toBe('AT&T and R&D');
    expect(cleanLine('On the <dl>')).toBe('On the <dl>');
  });

  it('collapses stray spacing', () => {
    expect(cleanLine('Writing,  Briefly')).toBe('Writing, Briefly');
    expect(cleanLine('  QUADRATURE   Dance of the Asuras ')).toBe('QUADRATURE Dance of the Asuras');
  });

  it('parses an RSS title with a character reference as text', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Heavy Topspin</title><link>https://example.com</link>
      <item><title>Ben Shelton&#8217;s Pliable Ceiling</title><link>https://example.com/a</link><dc:creator>Jeff&#8217;s Desk</dc:creator></item></channel></rss>`;
    const feed = parseFeed(xml, 'application/rss+xml', 'https://example.com/feed/');
    expect(feed.entries[0].title).toBe('Ben Shelton’s Pliable Ceiling');
    expect(feed.entries[0].author).toBe('Jeff’s Desk');
  });

  it('drops the WordPress "appeared first on" line from previews and reader HTML', () => {
    const summary = 'Grand opening this Saturday! The post New Persian Restaurant, Āzar, Opening This Weekend in Williamsburg appeared first on Greenpointers.';
    expect(entryPreviewText({ title: 'New Persian Restaurant, Āzar, Opening This Weekend in Williamsburg', summary_text: summary })).toBe('Grand opening this Saturday!');
    const html = '<p>Body.</p>\n<p>The post <a href="https://racquetmag.com/x/">X</a> appeared first on <a href="https://racquetmag.com/">Racquet</a>.</p>';
    expect(withoutFeedFooterHtml(html)).toBe('<p>Body.</p>');
    expect(sanitizeFeedHtml(html)).toBe('<p>Body.</p>');
  });

  it('opens a quotation preview without its elision mark and ends on a word', () => {
    expect(entryPreviewText({ title: 'Quote', summary_text: '[...] in the last 10 years I’ve learned to love CSS.' })).toBe('in the last 10 years I’ve learned to love CSS.');
    const long = `${'word '.repeat(30)}crown, [… more`;
    const preview = entryPreviewText({ title: 'T', summary_text: long }, 160) ?? '';
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toMatch(/[,[]…$/);
  });

  it('keeps an author out of the byline when the source already names them', () => {
    expect(distinctAuthor('NTS', 'NTS')).toBeNull();
    expect(distinctAuthor('Matt Levine', 'Matt Levine - Bloomberg Opinion Columnist')).toBeNull();
    expect(distinctAuthor('Ben Thompson', 'Stratechery')).toBe('Ben Thompson');
  });
});
