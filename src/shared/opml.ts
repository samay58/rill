import { XMLParser } from 'fast-xml-parser';
import { canonicalizeUrl } from './url';

export interface OpmlSubscription {
  title: string;
  feed_url: string;
  site_url: string | null;
  folder: string | null;
}

type UnknownRecord = Record<string, unknown>;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', trimValues: true });

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {};
}

function asArray(value: unknown): UnknownRecord[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(asRecord);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function canonicalMaybe(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    return canonicalizeUrl(raw);
  } catch {
    return null;
  }
}

function collectOutlines(outline: UnknownRecord, folder: string | null, output: OpmlSubscription[]): void {
  const feedUrl = canonicalMaybe(outline.xmlUrl);
  if (feedUrl) {
    output.push({
      title: text(outline.title) ?? text(outline.text) ?? feedUrl,
      feed_url: feedUrl,
      site_url: canonicalMaybe(outline.htmlUrl),
      folder
    });
    return;
  }

  const nextFolder = text(outline.title) ?? text(outline.text) ?? folder;
  for (const child of asArray(outline.outline)) collectOutlines(child, nextFolder, output);
}

export function parseOpmlSubscriptions(xml: string): OpmlSubscription[] {
  const root = asRecord(parser.parse(xml));
  const body = asRecord(asRecord(root.opml).body);
  const subscriptions: OpmlSubscription[] = [];
  for (const outline of asArray(body.outline)) collectOutlines(outline, null, subscriptions);

  const seen = new Set<string>();
  return subscriptions.filter((subscription) => {
    if (seen.has(subscription.feed_url)) return false;
    seen.add(subscription.feed_url);
    return true;
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function outlineFor(subscription: OpmlSubscription): string {
  const attrs = [
    `text="${escapeAttr(subscription.title)}"`,
    `title="${escapeAttr(subscription.title)}"`,
    'type="rss"',
    `xmlUrl="${escapeAttr(subscription.feed_url)}"`
  ];
  if (subscription.site_url) attrs.push(`htmlUrl="${escapeAttr(subscription.site_url)}"`);
  return `    <outline ${attrs.join(' ')} />`;
}

export function renderOpmlSubscriptions(subscriptions: OpmlSubscription[]): string {
  const folders = new Map<string | null, OpmlSubscription[]>();
  for (const subscription of subscriptions) {
    const key = subscription.folder?.trim() || null;
    folders.set(key, [...(folders.get(key) ?? []), { ...subscription, folder: key }]);
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>Rill Subscriptions</title></head>',
    '  <body>'
  ];
  for (const [folder, items] of folders) {
    if (folder) {
      lines.push(`    <outline text="${escapeAttr(folder)}">`);
      for (const item of items) lines.push(`  ${outlineFor(item)}`);
      lines.push('    </outline>');
    } else {
      for (const item of items) lines.push(outlineFor(item));
    }
  }
  lines.push('  </body>', '</opml>', '');
  return lines.join('\n');
}
