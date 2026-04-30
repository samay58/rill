import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { extractRemoteImages, htmlToPlainText, sanitizeFeedHtml } from '../shared/feed/sanitize';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MIN_READABLE_TEXT_LENGTH = 120;

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
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4 && isBlockedIpv4(mappedIpv4)) return true;

  return normalized === '::1'
    || normalized.startsWith('fe80:')
    || normalized.startsWith('fe90:')
    || normalized.startsWith('fea0:')
    || normalized.startsWith('feb0:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd');
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
  return new ArticleExtractionError('article_not_readable', 'Article could not be extracted.');
}

function extractContentTitle(contentHtml: string): string | null {
  const { document } = parseHTML(contentHtml);
  return document.querySelector('h1')?.textContent?.trim() || null;
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
    response = await fetcher(url, {
      credentials: 'omit',
      headers: new Headers({
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Rill article extraction'
      }),
      redirect: 'follow',
      signal: controller.signal
    });
  } catch {
    clearTimeout(timeout);
    throw new ArticleExtractionError('article_fetch_failed', 'Article could not be fetched.');
  }

  try {
    if (!response.ok) {
      throw new ArticleExtractionError('article_fetch_failed', 'Article could not be fetched.');
    }
    if (response.url && !isPublicHttpUrl(response.url)) {
      throw new ArticleExtractionError('invalid_article_url', 'Article redirected to a private URL.');
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
