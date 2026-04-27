import { parseDocument } from 'htmlparser2';
import type { AnyNode, Element } from 'domhandler';
import { resolveUrl } from '../url';

export type DiscoveredFeedType = 'rss' | 'atom' | 'json';

export interface DiscoveredFeed {
  title: string | null;
  type: DiscoveredFeedType;
  url: string;
}

const TYPE_PREFERENCE: Record<DiscoveredFeedType, number> = {
  json: 0,
  atom: 1,
  rss: 2
};

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag';
}

function feedTypeFromMime(type: string | undefined): DiscoveredFeedType | null {
  const value = (type ?? '').toLowerCase();
  if (value.includes('feed+json') || value.includes('json')) return 'json';
  if (value.includes('atom')) return 'atom';
  if (value.includes('rss') || value.includes('xml')) return 'rss';
  return null;
}

function visit(node: AnyNode, callback: (element: Element) => void): void {
  if (isElement(node)) callback(node);
  const children = 'children' in node ? node.children ?? [] : [];
  for (const child of children) visit(child, callback);
}

export function discoverFeedsFromHtml(html: string, pageUrl: string): DiscoveredFeed[] {
  const document = parseDocument(html, { decodeEntities: true });
  const discovered: DiscoveredFeed[] = [];
  for (const child of document.children) {
    visit(child, (element) => {
      if (element.name.toLowerCase() !== 'link') return;
      const rel = element.attribs?.rel?.toLowerCase() ?? '';
      if (!rel.split(/\s+/).includes('alternate')) return;
      const type = feedTypeFromMime(element.attribs?.type);
      if (!type) return;
      const url = resolveUrl(element.attribs?.href, pageUrl);
      if (!url) return;
      discovered.push({ title: element.attribs?.title ?? null, type, url });
    });
  }

  const seen = new Set<string>();
  return discovered
    .filter((feed) => {
      if (seen.has(feed.url)) return false;
      seen.add(feed.url);
      return true;
    })
    .sort((a, b) => TYPE_PREFERENCE[a.type] - TYPE_PREFERENCE[b.type] || a.url.localeCompare(b.url));
}

export function isLikelyFeedContentType(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return value.includes('rss') || value.includes('atom') || value.includes('feed+json') || value.includes('application/json') || value.includes('xml');
}
