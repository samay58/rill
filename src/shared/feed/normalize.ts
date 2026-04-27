import type { FeedType, UnixMs } from '../types';
import { canonicalizeUrl } from '../url';

export interface ParsedEntryInput {
  externalId?: string | null;
  url?: string | null;
  title?: string | null;
  publishedAt?: UnixMs | null;
}

export interface NormalizedEntry {
  stable_external_id: string;
  canonical_url: string | null;
  title: string | null;
  author: string | null;
  published_at: UnixMs | null;
  updated_at_feed: UnixMs | null;
  summary_text: string | null;
  content_text: string | null;
  content_html_sanitized: string | null;
  content_html_raw: string | null;
  has_remote_images: 0 | 1;
  remote_image_urls: string[];
}

export interface ParsedFeed {
  feed_type: FeedType;
  title: string | null;
  site_url: string | null;
  description: string | null;
  language: string | null;
  entries: NormalizedEntry[];
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function stableEntryId(feedId: string, entry: ParsedEntryInput): string {
  const external = entry.externalId?.trim();
  if (external) return external;
  if (entry.url) return canonicalizeUrl(entry.url);
  return `synthetic:${hashString(`${feedId}|${normalizeTitle(entry.title)}|${entry.publishedAt ?? ''}`)}`;
}

export function dedupeEntries(entries: NormalizedEntry[]): NormalizedEntry[] {
  const seen = new Map<string, NormalizedEntry>();
  for (const entry of entries) {
    if (!seen.has(entry.stable_external_id)) seen.set(entry.stable_external_id, entry);
  }
  return Array.from(seen.values());
}
