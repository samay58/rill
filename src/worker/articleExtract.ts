import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { extractRemoteImages, htmlToPlainText, sanitizeFeedHtml } from '../shared/feed/sanitize';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MIN_READABLE_TEXT_LENGTH = 120;
const MAX_REDIRECTS = 5;

type ArticleExtractionErrorCode = 'article_fetch_failed' | 'article_not_readable' | 'article_url_not_public' | 'invalid_article_url';

type ArticleFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ArticleExtractionError extends Error {
  readonly code: ArticleExtractionErrorCode;
  readonly status: number;

  constructor(code: ArticleExtractionErrorCode, message: string, status = 422) {
    super(message);
    this.name = 'ArticleExtractionError';
    this.code = code;
    this.status = status;
  }
}

export interface ExtractedArticle {
  title: string;
  content_html_sanitized: string;
  content_text: string;
  has_remote_images: number;
}

export interface ExtractPublicArticleOptions {
  fetcher?: ArticleFetcher;
  timeoutMs?: number;
  maxBytes?: number;
}

function isBlockedIpv4(hostname: string): boolean {
  const value = ipv4ToNumber(hostname);
  if (value === null) return false;

  return IPV4_BLOCKED_RANGES.some(([start, end]) => value >= start && value <= end);
}

function ipv4ToNumber(hostname: string): number | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return null;
  }

  return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
}

const IPV4_BLOCKED_RANGES: Array<[number, number]> = [
  ['0.0.0.0', '0.255.255.255'],
  ['10.0.0.0', '10.255.255.255'],
  ['100.64.0.0', '100.127.255.255'],
  ['127.0.0.0', '127.255.255.255'],
  ['169.254.0.0', '169.254.255.255'],
  ['172.16.0.0', '172.31.255.255'],
  ['192.0.0.0', '192.0.0.255'],
  ['192.0.2.0', '192.0.2.255'],
  ['192.88.99.0', '192.88.99.255'],
  ['192.168.0.0', '192.168.255.255'],
  ['198.18.0.0', '198.19.255.255'],
  ['198.51.100.0', '198.51.100.255'],
  ['203.0.113.0', '203.0.113.255'],
  ['224.0.0.0', '239.255.255.255'],
  ['240.0.0.0', '255.255.255.255']
].map(([start, end]) => [ipv4ToNumber(start) ?? 0, ipv4ToNumber(end) ?? 0]);

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4 && isBlockedIpv4(mappedIpv4)) return true;

  const hextets = expandIpv6(normalized);
  if (!hextets) return false;
  const [firstHextet, secondHextet, thirdHextet, fourthHextet] = hextets;
  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1;

  return isUnspecified
    || isLoopback
    || (firstHextet === 0x0100 && secondHextet === 0 && thirdHextet === 0 && fourthHextet === 0)
    || (firstHextet === 0x2001 && secondHextet <= 0x01ff)
    || (firstHextet === 0x2001 && secondHextet === 0x0db8)
    || firstHextet === 0x2002
    || (firstHextet === 0x3fff && secondHextet <= 0x0fff)
    || firstHextet === 0x5f00
    || (firstHextet & 0xfe00) === 0xfc00
    || (firstHextet & 0xffc0) === 0xfe80
    || (firstHextet & 0xff00) === 0xff00;
}

function expandIpv6(hostname: string): number[] | null {
  if (hostname.includes('.')) return null;
  const [leftText, rightText, extra] = hostname.split('::');
  if (extra !== undefined) return null;

  const left = leftText ? parseHextets(leftText) : [];
  const right = rightText ? parseHextets(rightText) : [];
  if (!left || !right) return null;

  if (rightText === undefined) return left.length === 8 ? left : null;

  const zeros = 8 - left.length - right.length;
  if (zeros < 0) return null;
  return [...left, ...Array(zeros).fill(0), ...right];
}

function parseHextets(value: string): number[] | null {
  const parts = value.split(':');
  const hextets = parts.map((part) => Number.parseInt(part, 16));
  if (parts.some((part, index) => part.length === 0 || part.length > 4 || !/^[0-9a-f]+$/i.test(part) || hextets[index] < 0 || hextets[index] > 0xffff)) {
    return null;
  }
  return hextets;
}

function ipv4FromMappedIpv6(hostname: string): string | null {
  if (!hostname.startsWith('::ffff:')) return null;

  const parts = hostname.slice('::ffff:'.length).split(':');
  if (parts.length !== 2) return null;

  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }

  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isPublicHttpUrl(value: string | null): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
    if (isBlockedIpv4(hostname)) return false;
    if (hostname.includes(':') && isBlockedIpv6(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const body = await response.arrayBuffer();
    if (body.byteLength > maxBytes) {
      throw new ArticleExtractionError('article_fetch_failed', 'Article response is too large.');
    }
    return new TextDecoder().decode(body);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ArticleExtractionError('article_fetch_failed', 'Article response is too large.');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function notReadable(): ArticleExtractionError {
  return new ArticleExtractionError('article_not_readable', 'Rill could not find a readable public article body.');
}

function extractContentTitle(contentHtml: string): string | null {
  const { document } = parseHTML(contentHtml);
  return document.querySelector('h1')?.textContent?.trim() || null;
}

function fetchInit(controller: AbortController): RequestInit {
  return {
    credentials: 'omit',
    headers: new Headers({
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Rill article extraction'
    }),
    redirect: 'manual',
    signal: controller.signal
  };
}

function invalidArticleUrl(message: string): ArticleExtractionError {
  return new ArticleExtractionError('invalid_article_url', message);
}

function isRedirectResponse(response: Response): boolean {
  return response.status >= 300 && response.status < 400 && response.status !== 304;
}

async function fetchWithValidatedRedirects(
  startUrl: string,
  fetcher: ArticleFetcher,
  controller: AbortController
): Promise<Response> {
  let currentUrl = startUrl;

  for (let redirectCount = 0; ; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetcher(currentUrl, fetchInit(controller));
    } catch {
      throw new ArticleExtractionError('article_fetch_failed', 'Article could not be fetched.');
    }

    if (!isRedirectResponse(response)) {
      if (response.url && !isPublicHttpUrl(response.url)) {
        throw invalidArticleUrl('Article redirected to a private URL.');
      }
      return response;
    }

    if (redirectCount >= MAX_REDIRECTS) {
      throw invalidArticleUrl('Article redirected too many times.');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new ArticleExtractionError('article_fetch_failed', 'Article redirect was incomplete.');
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw invalidArticleUrl('Article redirected to an invalid URL.');
    }

    if (!isPublicHttpUrl(nextUrl)) {
      throw invalidArticleUrl('Article redirected to a private URL.');
    }
    currentUrl = nextUrl;
  }
}

export async function extractPublicArticle(url: string, options: ExtractPublicArticleOptions = {}): Promise<ExtractedArticle> {
  if (!isPublicHttpUrl(url)) {
    throw new ArticleExtractionError('article_url_not_public', 'Article URL must be public HTTP or HTTPS.');
  }

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchWithValidatedRedirects(url, fetcher, controller);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }

  try {
    if (!response.ok) {
      throw new ArticleExtractionError('article_fetch_failed', 'Article could not be fetched.');
    }

    const html = await readLimitedText(response, maxBytes);
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (!article?.content) throw notReadable();

    const contentHtml = sanitizeFeedHtml(article.content);
    const contentText = htmlToPlainText(contentHtml);
    if (contentText.length < MIN_READABLE_TEXT_LENGTH) throw notReadable();

    const title = (
      extractContentTitle(article.content)
      ?? document.querySelector('article h1, h1')?.textContent?.trim()
      ?? article.title
      ?? document.title
      ?? ''
    ).trim();
    return {
      title: title || 'Untitled article',
      content_html_sanitized: contentHtml,
      content_text: contentText,
      has_remote_images: extractRemoteImages(contentHtml).length > 0 ? 1 : 0
    };
  } finally {
    clearTimeout(timeout);
  }
}
