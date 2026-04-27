import type { EntryWithState } from '../../shared/types';

const DEFAULT_MAX_CHARS = 180;
const HTML_TAG_RE = /<[^>]+>/;
const ENCODED_HTML_TAG_RE = /&lt;\/?[a-z][^&]*&gt;/i;

function normalize(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

function decodeHtmlText(value: string): string {
  if (typeof DOMParser === 'undefined') return value;
  const parsed = new DOMParser().parseFromString(`<main>${value}</main>`, 'text/html');
  return parsed.body.textContent ?? value;
}

function addBlockBoundaries(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, ' ');
}

function textFromMaybeHtml(value: string): string {
  let candidate = normalize(value);
  if (!HTML_TAG_RE.test(candidate) && ENCODED_HTML_TAG_RE.test(candidate)) {
    candidate = normalize(decodeHtmlText(candidate));
  }
  if (!HTML_TAG_RE.test(candidate)) return candidate;

  const bounded = addBlockBoundaries(candidate);
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(`<main>${bounded}</main>`, 'text/html');
    return normalize(parsed.body.textContent ?? '');
  }
  return normalize(bounded.replace(/<[^>]*>/g, ' '));
}

function truncateAtWord(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const sliced = value.slice(0, maxChars + 1);
  const boundary = sliced.lastIndexOf(' ');
  const trimmed = sliced.slice(0, boundary > 40 ? boundary : maxChars).trim();
  return `${trimmed}…`;
}

export function entryExcerpt(entry: EntryWithState, maxChars = DEFAULT_MAX_CHARS): string | null {
  const candidate = entry.summary_text ?? entry.content_text;
  if (!candidate) return null;

  const cleaned = textFromMaybeHtml(candidate);
  if (!cleaned) return null;
  if (entry.title && cleaned.toLowerCase() === entry.title.toLowerCase()) return null;

  return truncateAtWord(cleaned, maxChars);
}
