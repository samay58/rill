import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFeed } from '../../src/shared/feed/parse';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

describe('parseFeed', () => {
  it('uses rss guid for stable ids', () => {
    const feed = parseFeed(fixture('rss-guid.xml'), 'application/rss+xml', 'https://example.com/feed.xml');
    expect(feed.feed_type).toBe('rss');
    expect(feed.title).toBe('Guid Feed');
    expect(feed.entries.map((entry) => entry.stable_external_id)).toEqual(['guid-post-1', 'guid-post-2']);
    expect(feed.entries[0].canonical_url).toBe('https://example.com/posts/first');
  });

  it('falls back for rss entries without guid and dedupes repeated items', () => {
    const feed = parseFeed(fixture('rss-no-guid.xml'), 'application/rss+xml', 'https://noguid.example/feed.xml');
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0].stable_external_id).toBe('https://noguid.example/post?a=1');
  });

  it('parses atom id and updated fields', () => {
    const feed = parseFeed(fixture('atom.xml'), 'application/atom+xml', 'https://atom.example/feed.xml');
    expect(feed.feed_type).toBe('atom');
    expect(feed.entries[0].stable_external_id).toBe('tag:atom.example,2026:post-1');
    expect(feed.entries[0].author).toBe('Ada');
    expect(feed.entries[0].updated_at_feed).toBe(Date.parse('2026-04-27T12:00:00Z'));
    expect(feed.entries[0].canonical_url).toBe('https://atom.example/post-1');
  });

  it('parses json feed id and content fields', () => {
    const feed = parseFeed(fixture('json-feed.json'), 'application/feed+json', 'https://json.example/feed.json');
    expect(feed.feed_type).toBe('json');
    expect(feed.entries.map((entry) => entry.stable_external_id)).toEqual(['json-1', 'json-2']);
    expect(feed.entries[0].author).toBe('Grace');
    expect(feed.entries[0].canonical_url).toBe('https://json.example/json-1');
    expect(feed.entries[1].content_text).toBe('Text-only content.');
  });

  it('stores RSS HTML descriptions as clean preview text while keeping sanitized HTML for Reader', () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss><channel><title>HTML RSS</title><item>
        <title>Raw preview</title>
        <guid>raw-preview</guid>
        <description><![CDATA[<p>Dear readers, <strong>start here</strong>.</p><p><a href="https://example.com/path">Read the guide</a> today.</p>]]></description>
      </item></channel></rss>`, 'application/rss+xml', 'https://example.com/feed.xml');

    expect(feed.entries[0].summary_text).toBe('Dear readers, start here. Read the guide today.');
    expect(feed.entries[0].content_text).toBe('Dear readers, start here. Read the guide today.');
    expect(feed.entries[0].content_html_sanitized).toContain('<strong>start here</strong>');
    expect(feed.entries[0].summary_text).not.toContain('<p>');
    expect(feed.entries[0].summary_text).not.toContain('href=');
  });

  it('stores Atom HTML summaries as clean preview text', () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom HTML</title>
        <entry>
          <id>tag:example.com,2026:atom-html</id>
          <title>Atom preview</title>
          <updated>2026-04-27T12:00:00Z</updated>
          <summary type="html">&lt;p&gt;A clean &lt;strong&gt;Atom&lt;/strong&gt; preview.&lt;/p&gt;</summary>
          <content type="html">&lt;p&gt;Reader body.&lt;/p&gt;</content>
        </entry>
      </feed>`, 'application/atom+xml', 'https://example.com/atom.xml');

    expect(feed.entries[0].summary_text).toBe('A clean Atom preview.');
    expect(feed.entries[0].summary_text).not.toContain('<strong>');
    expect(feed.entries[0].content_html_sanitized).toContain('<p>Reader body.</p>');
  });

  it('stores JSON Feed HTML summaries as clean preview text', () => {
    const feed = parseFeed(JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'JSON HTML',
      items: [{
        id: 'json-html-1',
        title: 'HTML summary',
        summary: '<p>A short <em>useful</em> preview.</p>',
        content_html: '<p>A short <em>useful</em> preview.</p><p>Reader body.</p>'
      }]
    }), 'application/feed+json', 'https://example.com/feed.json');

    expect(feed.entries[0].summary_text).toBe('A short useful preview.');
    expect(feed.entries[0].summary_text).not.toContain('<em>');
    expect(feed.entries[0].content_html_sanitized).toContain('<p>Reader body.</p>');
  });

  it('normalizes escaped uppercase RSS HTML from aggregator feeds before storage', () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss><channel><title>Techmeme</title><item>
        <title>Filing: Beijing-based GPU maker Moore Threads reports Q1 revenue up 155% YoY to ~$107.89M, and a $4.3M net profit, up from a ~$16.46M net loss in Q1 2025 (Iris Deng/South China Morning Post)</title>
        <guid>techmeme-1</guid>
        <description>&lt;A HREF=&quot;https://www.scmp.com/tech/article/3351492/moore-threads-posts-us43m-profit-nvidia-rival-surges-amid-beijing-chip-push&quot;&gt;&lt;IMG VSPACE=&quot;4&quot; HSPACE=&quot;4&quot; BORDER=&quot;0&quot; ALIGN=&quot;RIGHT&quot; SRC=&quot;http://www.techmeme.com/260427/i3.jpg&quot;&gt;&lt;/A&gt; &lt;P&gt;&lt;A HREF=&quot;http://www.techmeme.com/260427/p3#a260427p3&quot; TITLE=&quot;Techmeme permalink&quot;&gt;&lt;IMG WIDTH=11 HEIGHT=12 SRC=&quot;http://www.techmeme.com/img/pml.png&quot; STYLE=&quot;border:none;padding:0;margin:0;&quot;&gt;&lt;/A&gt; Iris Deng / &lt;A HREF=&quot;http://www.scmp.com/&quot;&gt;South China Morning Post&lt;/A&gt;:&lt;BR&gt; &lt;SPAN STYLE=&quot;font-size:1.3em;&quot;&gt;&lt;B&gt;&lt;A HREF=&quot;https://www.scmp.com/tech/article/3351492/moore-threads-posts-us43m-profit-nvidia-rival-surges-amid-beijing-chip-push&quot;&gt;Filing: Beijing-based GPU maker Moore Threads reports Q1 revenue up 155% YoY to ~$107.89M, and a $4.3M net profit, up from a ~$16.46M net loss in Q1 2025&lt;/A&gt;&lt;/B&gt;&lt;/SPAN&gt;&amp;nbsp; &amp;mdash;&amp;nbsp; Beijing-based GPU maker turns a corner in the first quarter of 2026 after posting a US$16.5 million loss a year earlier&lt;/P&gt;</description>
      </item></channel></rss>`, 'application/rss+xml', 'https://techmeme.com/feed.xml');

    expect(feed.entries[0].summary_text).toBe('Iris Deng / South China Morning Post: Filing: Beijing-based GPU maker Moore Threads reports Q1 revenue up 155% YoY to ~$107.89M, and a $4.3M net profit, up from a ~$16.46M net loss in Q1 2025 — Beijing-based GPU maker turns a corner in the first quarter of 2026 after posting a US$16.5 million loss a year earlier');
    expect(feed.entries[0].content_text).toBe(feed.entries[0].summary_text);
    expect(feed.entries[0].summary_text).not.toContain('<A HREF');
    expect(feed.entries[0].content_text).not.toContain('IMG');
    expect(feed.entries[0].has_remote_images).toBe(1);
  });

});
