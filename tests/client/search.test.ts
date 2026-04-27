import { describe, expect, it } from 'vitest';
import type { Entry, Feed } from '../../src/shared/types';
import { MemoryStore } from './memoryStore';
import { searchLocalEntries } from '../../src/client/search';

function feed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 'feed-1',
    canonical_feed_url: 'https://example.com/feed.xml',
    site_url: 'https://example.com/',
    discovered_from_url: null,
    feed_type: 'rss',
    title: 'Notebook Letters',
    description: null,
    language: null,
    etag: null,
    last_modified: null,
    icon_url: null,
    updated_at: 1,
    created_at: 1,
    ...overrides
  };
}

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    feed_id: 'feed-1',
    stable_external_id: id,
    canonical_url: `https://example.com/${id}`,
    title: 'Quiet defaults',
    author: 'Ada Writer',
    published_at: 10,
    updated_at_feed: null,
    summary_text: 'A field note about calm software.',
    content_text: 'Reading tools should stay out of the way.',
    content_html_sanitized: null,
    content_html_raw: null,
    has_remote_images: 0,
    content_hash: null,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

describe('local search', () => {
  it('matches source, title, author, summary, and content text while offline', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.put('entries', entry('entry-1'));

    await expect(searchLocalEntries(store, 'notebook')).resolves.toMatchObject([{ entry: { id: 'entry-1' }, sourceTitle: 'Notebook Letters' }]);
    await expect(searchLocalEntries(store, 'quiet defaults')).resolves.toHaveLength(1);
    await expect(searchLocalEntries(store, 'ada writer')).resolves.toHaveLength(1);
    await expect(searchLocalEntries(store, 'field note')).resolves.toHaveLength(1);
    await expect(searchLocalEntries(store, 'stay out of the way')).resolves.toHaveLength(1);
  });

  it('returns newest matching entries first and ignores blank queries', async () => {
    const store = new MemoryStore();
    await store.put('feeds', feed());
    await store.putMany('entries', [
      entry('older', { title: 'Local cache', published_at: 100 }),
      entry('newer', { title: 'Local cache', published_at: 200 })
    ]);

    expect((await searchLocalEntries(store, 'local cache')).map((result) => result.entry.id)).toEqual(['newer', 'older']);
    await expect(searchLocalEntries(store, '   ')).resolves.toEqual([]);
  });
});
