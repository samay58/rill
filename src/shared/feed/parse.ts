import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { FeedType, UnixMs } from '../types';
import { canonicalizeUrl, resolveUrl } from '../url';
import { dedupeEntries, type NormalizedEntry, type ParsedFeed, stableEntryId } from './normalize';
import { cleanFeedText, extractRemoteImages, htmlToPlainText, sanitizeFeedHtml } from './sanitize';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  cdataPropName: '#text',
  trimValues: true
});

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
  const record = asRecord(value);
  return textOf(record['#text']) ?? textOf(record._);
}

function parseDate(value: unknown): UnixMs | null {
  const text = textOf(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function contentFrom(html: string | null, text: string | null) {
  const rawHtml = html;
  const sanitized = rawHtml ? sanitizeFeedHtml(rawHtml) : null;
  const remoteImages = rawHtml ? extractRemoteImages(rawHtml) : [];
  const plainText = rawHtml ? htmlToPlainText(rawHtml) || null : cleanFeedText(text);
  return {
    content_html_raw: rawHtml,
    content_html_sanitized: sanitized,
    content_text: plainText,
    has_remote_images: remoteImages.length > 0 ? 1 as const : 0 as const,
    remote_image_urls: remoteImages
  };
}

function normalizeUrl(value: string | null, baseUrl: string): string | null {
  const resolved = resolveUrl(value, baseUrl);
  if (!resolved) return null;
  return canonicalizeUrl(resolved);
}

function rssGuid(item: UnknownRecord): string | null {
  return textOf(item.guid);
}

function parseRss(root: UnknownRecord, feedUrl: string): ParsedFeed {
  const channel = asRecord(asRecord(root.rss).channel);
  const feedTitle = textOf(channel.title);
  const siteUrl = normalizeUrl(textOf(channel.link), feedUrl);
  const entries = asArray(channel.item as UnknownRecord | UnknownRecord[] | undefined).map((item): NormalizedEntry => {
    const url = normalizeUrl(textOf(item.link), feedUrl);
    const title = textOf(item.title);
    const published = parseDate(item.pubDate) ?? parseDate(item.date);
    const summary = textOf(item.description);
    const html = summary && /<[^>]+>/.test(summary) ? summary : null;
    const content = contentFrom(html, summary);
    return {
      stable_external_id: stableEntryId(feedUrl, { externalId: rssGuid(item), url, title, publishedAt: published }),
      canonical_url: url,
      title,
      author: textOf(item.author) ?? textOf(item['dc:creator']),
      published_at: published,
      updated_at_feed: parseDate(item.updated),
      summary_text: cleanFeedText(summary),
      ...content
    };
  });
  return {
    feed_type: 'rss',
    title: feedTitle,
    site_url: siteUrl,
    description: textOf(channel.description),
    language: textOf(channel.language),
    entries: dedupeEntries(entries)
  };
}

function atomLink(value: unknown): string | null {
  const links = asArray(value as UnknownRecord | UnknownRecord[] | undefined);
  const alternate = links.find((link) => !link.rel || link.rel === 'alternate') ?? links[0];
  return alternate ? textOf(alternate.href) : null;
}

function parseAtom(root: UnknownRecord, feedUrl: string): ParsedFeed {
  const feed = asRecord(root.feed);
  const entries = asArray(feed.entry as UnknownRecord | UnknownRecord[] | undefined).map((entry): NormalizedEntry => {
    const url = normalizeUrl(atomLink(entry.link), feedUrl);
    const title = textOf(entry.title);
    const published = parseDate(entry.published) ?? parseDate(entry.updated);
    const contentRecord = asRecord(entry.content);
    const contentHtml = textOf(entry.content);
    const summary = textOf(entry.summary);
    const html = contentRecord.type === 'html' ? contentHtml : null;
    const content = contentFrom(html, contentRecord.type === 'text' ? contentHtml : summary);
    return {
      stable_external_id: stableEntryId(feedUrl, { externalId: textOf(entry.id), url, title, publishedAt: published }),
      canonical_url: url,
      title,
      author: textOf(asRecord(entry.author).name),
      published_at: published,
      updated_at_feed: parseDate(entry.updated),
      summary_text: cleanFeedText(summary),
      ...content
    };
  });
  return {
    feed_type: 'atom',
    title: textOf(feed.title),
    site_url: normalizeUrl(atomLink(feed.link), feedUrl),
    description: textOf(feed.subtitle),
    language: textOf(feed.lang),
    entries: dedupeEntries(entries)
  };
}

interface JsonFeedItem {
  id?: string;
  url?: string;
  external_url?: string;
  title?: string;
  summary?: string;
  content_html?: string;
  content_text?: string;
  date_published?: string;
  date_modified?: string;
  author?: { name?: string };
  authors?: Array<{ name?: string }>;
}

function parseJsonFeed(json: UnknownRecord, feedUrl: string): ParsedFeed {
  const items = asArray(json.items as JsonFeedItem[] | JsonFeedItem | undefined);
  const entries = items.map((item): NormalizedEntry => {
    const url = normalizeUrl(item.url ?? item.external_url ?? null, feedUrl);
    const title = item.title?.trim() || null;
    const published = parseDate(item.date_published);
    const content = contentFrom(item.content_html ?? null, item.content_text ?? item.summary ?? null);
    return {
      stable_external_id: stableEntryId(feedUrl, { externalId: item.id, url, title, publishedAt: published }),
      canonical_url: url,
      title,
      author: item.author?.name ?? item.authors?.[0]?.name ?? null,
      published_at: published,
      updated_at_feed: parseDate(item.date_modified),
      summary_text: cleanFeedText(item.summary ?? null),
      ...content
    };
  });
  return {
    feed_type: 'json',
    title: textOf(json.title),
    site_url: normalizeUrl(textOf(json.home_page_url), feedUrl),
    description: textOf(json.description),
    language: textOf(json.language),
    entries: dedupeEntries(entries)
  };
}

function parseXml(body: string): UnknownRecord {
  const validation = XMLValidator.validate(body);
  if (validation !== true) throw new Error('malformed_xml');
  return xmlParser.parse(body) as UnknownRecord;
}

function detectFeedType(body: string, contentType: string): FeedType {
  const lowerType = contentType.toLowerCase();
  const trimmed = body.trimStart();
  if (lowerType.includes('json') || trimmed.startsWith('{')) return 'json';
  const parsed = parseXml(body);
  if ('feed' in parsed) return 'atom';
  if ('rss' in parsed) return 'rss';
  throw new Error('unsupported_feed_format');
}

export function parseFeed(body: string, contentType: string, feedUrl: string): ParsedFeed {
  const feedType = detectFeedType(body, contentType);
  if (feedType === 'json') return parseJsonFeed(JSON.parse(body) as UnknownRecord, feedUrl);
  const parsed = parseXml(body);
  if (feedType === 'atom') return parseAtom(parsed, feedUrl);
  return parseRss(parsed, feedUrl);
}
