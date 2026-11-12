import { entryContentHash } from '../../shared/contentHash';
import { htmlToPlainText, sanitizeFeedHtml } from '../../shared/feed/sanitize';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';
import { verifyToken } from '../auth';
import { createSubscription, getUserById, upsertEntry, upsertFeed } from '../db';
import type { Env } from '../env';
import { entryId } from '../feedFetch';

// Morning Edition is built on the Mac Mini and posted here once a day. It is stored as an
// ordinary feed and entry so the reader, search and read state all work unchanged. The feed
// gets no refresh-queue row, so the poller never tries to fetch it.
export const EDITION_FEED_PATH = '/edition';
const EDITION_FOLDER = 'Edition';
const MAX_HTML_BYTES = 400_000;

function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function handleIngestRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/ingest/edition') return null;
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, { status: 405 });

  const token = bearer(request);
  if (!env.RILL_INGEST_TOKEN_HASH || !token || !(await verifyToken(token, env.RILL_INGEST_TOKEN_HASH))) {
    return json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, code: 'invalid_json' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const publishedAt = typeof body.published_at === 'number' && Number.isFinite(body.published_at) ? Math.floor(body.published_at) : clock();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id) || !title || !html) {
    return json({ ok: false, code: 'invalid_edition', message: 'Needs id (YYYY-MM-DD), title and html.' }, { status: 400 });
  }
  if (html.length > MAX_HTML_BYTES) return json({ ok: false, code: 'too_large' }, { status: 413 });

  const userId = env.RILL_INGEST_USER_ID ?? 'user-1';
  const user = await getUserById(env.DB, userId);
  if (!user) return json({ ok: false, code: 'user_not_found' }, { status: 404 });

  const now = clock();
  const feedUrl = `${url.origin}${EDITION_FEED_PATH}`;
  const feedId = `feed:${feedUrl}`;
  await upsertFeed(env.DB, {
    id: feedId,
    canonical_feed_url: feedUrl,
    site_url: url.origin,
    discovered_from_url: null,
    feed_type: 'rss',
    title: 'Morning Edition',
    description: 'The daily front page, built on the Mini.',
    language: 'en',
    etag: null,
    last_modified: null,
    icon_url: null,
    created_at: now,
    updated_at: now
  });
  // sort_order -1 keeps the edition above every other source.
  await createSubscription(env.DB, {
    id: `sub:${user.id}:${feedId}`,
    user_id: user.id,
    feed_id: feedId,
    folder: EDITION_FOLDER,
    sort_order: -1,
    is_archived: 0,
    created_at: now,
    updated_at: now
  });

  const sanitized = sanitizeFeedHtml(html, { baseUrl: url.origin });
  const text = htmlToPlainText(sanitized);
  const entry = {
    stable_external_id: `edition:${id}`,
    canonical_url: `${feedUrl}/${id}`,
    title,
    author: null,
    published_at: publishedAt,
    updated_at_feed: now,
    summary_text: text.slice(0, 280),
    content_text: text,
    content_html_sanitized: sanitized,
    content_html_raw: null,
    has_remote_images: 0 as const,
    remote_image_urls: []
  };
  await upsertEntry(env.DB, {
    ...entry,
    id: entryId(feedId, entry.stable_external_id),
    feed_id: feedId,
    content_hash: entryContentHash(entry),
    created_at: now,
    updated_at: now
  });
  return json({ ok: true, entry_id: entryId(feedId, entry.stable_external_id) });
}
