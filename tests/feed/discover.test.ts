import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverFeedsFromHtml, isLikelyFeedContentType } from '../../src/shared/feed/discover';

const html = readFileSync(join(process.cwd(), 'tests/fixtures/discovery.html'), 'utf8');

describe('discoverFeedsFromHtml', () => {
  it('discovers and sorts alternate feed links from a normal site url', () => {
    const feeds = discoverFeedsFromHtml(html, 'https://discover.example/articles');
    expect(feeds).toEqual([
      { title: 'JSON', type: 'json', url: 'https://discover.example/feed.json' },
      { title: 'Atom', type: 'atom', url: 'https://discover.example/atom.xml' },
      { title: 'RSS', type: 'rss', url: 'https://discover.example/rss.xml' }
    ]);
  });

  it('recognizes supported feed content types', () => {
    expect(isLikelyFeedContentType('application/feed+json')).toBe(true);
    expect(isLikelyFeedContentType('application/atom+xml')).toBe(true);
    expect(isLikelyFeedContentType('application/rss+xml')).toBe(true);
    expect(isLikelyFeedContentType('text/html')).toBe(false);
  });
});
