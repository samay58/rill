import { extractRemoteImages } from '../../shared/feed/sanitize';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';
import { requireUser } from '../auth';
import { getEntryForUser } from '../db';
import type { Env } from '../env';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8000;

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function routeUser(request: Request, env: Env, clock: Clock) {
  try {
    return await requireUser(request, env, clock);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

function ipv4Value(hostname: string): number | null {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) return true;
  const value = ipv4Value(host);
  if (value === null) return false;
  return (value >>> 24) === 10
    || (value >>> 24) === 127
    || (value >>> 20) === 0xac1
    || (value >>> 16) === 0xc0a8
    || (value >>> 16) === 0xa9fe
    || value === 0;
}

function parsePublicHttpUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isPrivateHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function allowedImages(rawHtml: string | null, sanitizedHtml: string | null): Set<string> {
  return new Set([
    ...extractRemoteImages(rawHtml ?? ''),
    ...extractRemoteImages(sanitizedHtml ?? '')
  ]);
}

export async function handleImageRoute(
  request: Request,
  env: Env,
  clock: Clock = systemClock,
  fetcher: typeof fetch = fetch
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/image' || request.method !== 'GET') return null;

  const user = await routeUser(request, env, clock);
  if (user instanceof Response) return user;

  const entryId = url.searchParams.get('entry_id');
  const sourceUrl = parsePublicHttpUrl(url.searchParams.get('src'));
  if (!entryId || !sourceUrl) return text('Invalid image URL.', 400);

  const entry = await getEntryForUser(env.DB, user.id, entryId);
  if (!entry) return text('Entry not found.', 404);
  if (!allowedImages(entry.content_html_raw, entry.content_html_sanitized).has(sourceUrl.toString())) return text('Image is not listed on this entry.', 403);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetcher(sourceUrl.toString(), {
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8' },
      redirect: 'follow',
      referrer: '',
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') return text('Image fetch timed out.', 504);
    return text('Image fetch failed.', 502);
  }
  clearTimeout(timeout);

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('image/')) return text('Upstream did not return an image.', 415);
  const declaredLength = Number(upstream.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) return text('Image is too large.', 413);
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_IMAGE_BYTES) return text('Image is too large.', 413);

  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}
