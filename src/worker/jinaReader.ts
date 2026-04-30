import type { ExtractedArticle } from './articleExtract';
import { ArticleExtractionError, isPublicHttpUrl } from './articleExtract';
import { htmlToPlainText, sanitizeFeedHtml } from '../shared/feed/sanitize';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 500_000;
const MIN_READER_TEXT_LENGTH = 120;
const READER_URL = 'https://r.jina.ai/';

export interface JinaReaderOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

interface JinaJsonResponse {
  title?: unknown;
  content?: unknown;
  url?: unknown;
  data?: {
    title?: unknown;
    content?: unknown;
    url?: unknown;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function markdownToHtml(markdown: string): string {
  return markdownToPlainText(markdown)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ArticleExtractionError('article_fetch_failed', 'Reader fallback response is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseReaderPayload(body: string): { title: string | null; markdown: string } {
  try {
    const parsed = JSON.parse(body) as JinaJsonResponse;
    const data = parsed.data ?? parsed;
    return {
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null,
      markdown: typeof data.content === 'string' ? data.content : ''
    };
  } catch {
    return { title: null, markdown: body };
  }
}

export async function extractWithJinaReader(url: string, options: JinaReaderOptions = {}): Promise<ExtractedArticle> {
  if (!isPublicHttpUrl(url)) {
    throw new ArticleExtractionError('article_url_not_public', 'Reader fallback URL must be public HTTP(S).');
  }

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = new URLSearchParams({ url });
    const response = await fetcher(READER_URL, {
      method: 'POST',
      credentials: 'omit',
      headers: new Headers({
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'x-respond-with': 'markdown'
      }),
      body,
      signal: controller.signal
    });
    if (!response.ok) throw new ArticleExtractionError('article_fetch_failed', 'Reader fallback could not fetch the article.');

    const payload = parseReaderPayload(await readLimitedText(response, maxBytes));
    const contentHtml = sanitizeFeedHtml(markdownToHtml(payload.markdown));
    const contentText = htmlToPlainText(contentHtml);
    if (contentText.length < MIN_READER_TEXT_LENGTH) {
      throw new ArticleExtractionError('article_not_readable', 'Reader fallback could not find a readable article body.');
    }

    return {
      title: payload.title ?? 'Untitled article',
      content_html_sanitized: contentHtml,
      content_text: contentText,
      has_remote_images: 0
    };
  } catch (error) {
    if (error instanceof ArticleExtractionError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ArticleExtractionError('article_fetch_failed', 'Reader fallback timed out.');
    }
    throw new ArticleExtractionError('article_fetch_failed', 'Reader fallback failed.');
  } finally {
    clearTimeout(timeout);
  }
}
