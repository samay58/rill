import type { UnixMs } from './types';

const DEFAULT_PREVIEW_CHARS = 180;
const TAG_RE = /<\/?[a-z][^>]*>/i;
const ENCODED_TAG_RE = /&lt;\/?[a-z][\s\S]*?&gt;/i;

export interface EntryTextFields {
  source_title?: string | null;
  title?: string | null;
  author?: string | null;
  summary_text?: string | null;
  content_text?: string | null;
  published_at?: UnixMs | null;
  created_at?: UnixMs;
}

export interface SearchRank {
  score: number;
}

export function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+([—–-])\s+/g, ' $1 ')
    .trim();
}

function decodeEntities(value: string): string {
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(`<main>${value}</main>`, 'text/html');
    return parsed.body.textContent ?? value;
  }

  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&amp;/gi, '&');
}

function stripHtml(value: string): string {
  return value
    .replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(img|svg|picture|source)\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|section|article|tr|table|ul|ol)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function removeFeedNoise(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bTechmeme permalink\b/gi, ' ')
    .replace(/\b(permalink|read more|continue reading)\b\s*$/gi, ' ');
}

export function plainTextFromMaybeHtml(value: string | null | undefined): string | null {
  if (!value) return null;

  let candidate = value;
  for (let index = 0; index < 2 && ENCODED_TAG_RE.test(candidate); index += 1) {
    candidate = decodeEntities(candidate);
  }

  if (TAG_RE.test(candidate)) candidate = stripHtml(candidate);
  candidate = removeFeedNoise(decodeEntities(candidate));
  candidate = normalizeText(candidate);

  return candidate.length > 0 ? candidate : null;
}

function titleVariants(title: string | null | undefined): string[] {
  const normalized = plainTextFromMaybeHtml(title) ?? '';
  const withoutParenthetical = normalized.replace(/\s+\([^)]{2,120}\)\s*$/, '').trim();
  return Array.from(new Set([normalized, withoutParenthetical].filter((item) => item.length > 0)));
}

function removeLeadingAttribution(text: string): string {
  return text.replace(/^[^:]{2,120}:\s+(?=[A-Z0-9])/u, '').trim();
}

function stripTitleEcho(text: string, title: string | null | undefined): string | null {
  let candidate = normalizeText(text);
  for (const variant of titleVariants(title).sort((left, right) => right.length - left.length)) {
    const index = candidate.toLowerCase().indexOf(variant.toLowerCase());
    if (index === -1) continue;

    const before = candidate.slice(0, index).trim();
    const after = candidate.slice(index + variant.length).replace(/^\s*(?:[—–-]|:|\.|,|;)+\s*/, '').trim();
    if (after.length >= 40) return after;
    if (before.length >= 40) return removeLeadingAttribution(before);
    if (candidate.toLowerCase() === variant.toLowerCase()) return null;
  }

  candidate = removeLeadingAttribution(candidate);
  return candidate.length > 0 ? candidate : null;
}

function truncateAtWord(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const sliced = value.slice(0, maxChars + 1);
  const boundary = sliced.lastIndexOf(' ');
  const trimmed = sliced.slice(0, boundary > 40 ? boundary : maxChars).trim();
  return `${trimmed}…`;
}

export function entryPreviewText(entry: EntryTextFields, maxChars = DEFAULT_PREVIEW_CHARS): string | null {
  const raw = entry.summary_text ?? entry.content_text;
  const plain = plainTextFromMaybeHtml(raw);
  if (!plain) return null;

  const withoutTitle = stripTitleEcho(plain, entry.title);
  if (!withoutTitle) return null;

  const cleaned = normalizeText(withoutTitle);
  if (!cleaned || titleVariants(entry.title).some((title) => cleaned.toLowerCase() === title.toLowerCase())) return null;
  return truncateAtWord(cleaned, maxChars);
}

function words(value: string | null | undefined): string[] {
  const plain = plainTextFromMaybeHtml(value) ?? '';
  return plain
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]+/g) ?? [];
}

function phrase(value: string | null | undefined): string {
  return words(value).join(' ');
}

function editDistanceOne(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  let mismatches = 0;
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }

    mismatches += 1;
    if (mismatches > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  return true;
}

function tokenInField(token: string, fieldWords: string[], fuzzy: boolean): boolean {
  return fieldWords.some((word) => word === token || (fuzzy && token.length >= 2 && word.length >= 2 && editDistanceOne(token, word)));
}

function allTokensMatch(tokens: string[], fieldWords: string[], fuzzy: boolean): boolean {
  return tokens.every((token) => tokenInField(token, fieldWords, fuzzy));
}

export function rankSearchEntry(entry: EntryTextFields, query: string, sourceTitle = entry.source_title ?? null): SearchRank | null {
  const queryTokens = words(query);
  if (queryTokens.length === 0) return null;

  const queryPhrase = queryTokens.join(' ');
  const sourceTitleText = [sourceTitle, entry.title].filter(Boolean).join(' ');
  const sourceTitleWords = words(sourceTitleText);
  const sourceTitlePhrase = sourceTitleWords.join(' ');
  const preview = entryPreviewText(entry, 600);
  const bodyText = [entry.author, preview, entry.content_text].filter(Boolean).join(' ');
  const bodyWords = words(bodyText);
  const bodyPhrase = phrase(bodyText);

  if (sourceTitlePhrase.includes(queryPhrase)) return { score: 1000 };
  if (allTokensMatch(queryTokens, sourceTitleWords, true)) return { score: 850 };
  if (bodyPhrase.includes(queryPhrase)) return { score: 350 };
  if (allTokensMatch(queryTokens, bodyWords, false)) return { score: 250 };
  return null;
}

export function compareRankedEntries<T extends EntryTextFields>(left: { entry: T; rank: SearchRank }, right: { entry: T; rank: SearchRank }): number {
  if (right.rank.score !== left.rank.score) return right.rank.score - left.rank.score;
  return (right.entry.published_at ?? right.entry.created_at ?? 0) - (left.entry.published_at ?? left.entry.created_at ?? 0);
}
