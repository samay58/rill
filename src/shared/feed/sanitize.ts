import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import type { AnyNode, Element, Text } from 'domhandler';
import { normalizeText, plainTextFromMaybeHtml } from '../entryText';

const BLOCKED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'style', 'link', 'meta']);
const URL_ATTRS = new Set(['href', 'src']);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function isSafeUrl(value: string): boolean {
  try {
    const parsed = new URL(value, 'https://rill.local');
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return true;
    return ALLOWED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function cleanNode(node: AnyNode): AnyNode | null {
  if (!isElement(node)) return node;
  if (BLOCKED_TAGS.has(node.name.toLowerCase())) return null;

  for (const attr of Object.keys(node.attribs ?? {})) {
    const lower = attr.toLowerCase();
    const value = node.attribs[attr];
    if (lower.startsWith('on') || lower === 'srcset') {
      delete node.attribs[attr];
      continue;
    }
    if (URL_ATTRS.has(lower) && !isSafeUrl(value)) {
      delete node.attribs[attr];
    }
  }

  node.children = node.children.map(cleanNode).filter((child): child is AnyNode => child !== null);
  return node;
}

export function sanitizeFeedHtml(html: string): string {
  const document = parseDocument(html, { decodeEntities: true });
  document.children = document.children.map(cleanNode).filter((child): child is AnyNode => child !== null);
  return render(document.children, { encodeEntities: 'utf8' });
}

function isTextNode(node: AnyNode): node is Text {
  return node.type === 'text';
}

const TEXT_BOUNDARY_TAGS = new Set(['p', 'div', 'br', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const TRAILING_TEXT_BOUNDARY_TAGS = new Set(['p', 'div', 'li', 'blockquote']);

function collectText(node: AnyNode, parts: string[]): void {
  if (isTextNode(node)) {
    if (node.data.trim()) parts.push(node.data);
    return;
  }

  if (isElement(node)) {
    const name = node.name.toLowerCase();
    if (BLOCKED_TAGS.has(name)) return;
    if (TEXT_BOUNDARY_TAGS.has(name)) parts.push(' ');
  }

  const children = 'children' in node ? node.children ?? [] : [];
  for (const child of children) collectText(child, parts);

  if (isElement(node) && TRAILING_TEXT_BOUNDARY_TAGS.has(node.name.toLowerCase())) {
    parts.push(' ');
  }
}

export function htmlToPlainText(html: string): string {
  const document = parseDocument(html, { decodeEntities: true });
  const parts: string[] = [];
  for (const child of document.children) collectText(child, parts);
  return parts.join('').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

export function cleanFeedText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = /<[^>]+>/.test(value) && !/&lt;\/?[a-z][\s\S]*?&gt;/i.test(value)
    ? normalizeText(htmlToPlainText(value))
    : plainTextFromMaybeHtml(value);
  return cleaned && cleaned.length > 0 ? cleaned : null;
}

export function extractRemoteImages(html: string): string[] {
  const document = parseDocument(html, { decodeEntities: true });
  const urls: string[] = [];

  function visit(node: AnyNode): void {
    if (isElement(node) && node.name.toLowerCase() === 'img') {
      const src = node.attribs?.src;
      if (src) {
        try {
          const parsed = new URL(src);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') urls.push(parsed.toString());
        } catch {}
      }
    }
    const children = 'children' in node ? node.children ?? [] : [];
    for (const child of children) visit(child);
  }

  for (const child of document.children) visit(child);
  return Array.from(new Set(urls));
}
