import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOpmlSubscriptions, renderOpmlSubscriptions } from '../src/shared/opml';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf8');
}

describe('OPML helpers', () => {
  it('imports folders, skips invalid outlines, and dedupes feed URLs', () => {
    const parsed = parseOpmlSubscriptions(fixture('subscriptions.opml'));

    expect(parsed).toEqual([
      { title: 'Daring Fireball', feed_url: 'https://daringfireball.net/feeds/main', site_url: 'https://daringfireball.net/', folder: 'Tech' },
      { title: 'Kottke', feed_url: 'https://kottke.org/index.xml', site_url: 'https://kottke.org/', folder: 'Personal' }
    ]);
  });

  it('exports title text xmlUrl and htmlUrl fields', () => {
    const opml = renderOpmlSubscriptions([
      { title: 'Notebook Letters', feed_url: 'https://example.com/feed.xml', site_url: 'https://example.com/', folder: 'Writing' }
    ]);

    expect(opml).toContain('<outline text="Writing">');
    expect(opml).toContain('title="Notebook Letters"');
    expect(opml).toContain('text="Notebook Letters"');
    expect(opml).toContain('xmlUrl="https://example.com/feed.xml"');
    expect(opml).toContain('htmlUrl="https://example.com/"');
  });

  it('round trips exported subscriptions', () => {
    const original = [
      { title: 'One', feed_url: 'https://one.example/feed.xml', site_url: 'https://one.example/', folder: null },
      { title: 'Two', feed_url: 'https://two.example/feed.xml', site_url: null, folder: 'Folder' }
    ];

    expect(parseOpmlSubscriptions(renderOpmlSubscriptions(original))).toEqual(original);
  });
});
