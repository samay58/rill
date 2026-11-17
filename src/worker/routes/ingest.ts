import { entryContentHash } from '../../shared/contentHash';
import { htmlToPlainText, sanitizeFeedHtml } from '../../shared/feed/sanitize';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';
import { verifyToken } from '../auth';
import { createSubscription, getUserById, upsertEntry, upsertFeed } from '../db';
import type { Env } from '../env';
import { entryId } from '../feedFetch';
import { entriesNear, feedByUrl, foldStandaloneLetter, isSubscribed, letterContentHash, matchingEntry, upgradeEntryWithLetter } from '../letters';

// Morning Edition is built on the Mac Mini and posted here once a day. It is stored as an
// ordinary feed and entry so the reader, search and read state all work unchanged. The feed
// gets no refresh-queue row, so the poller never tries to fetch it.
export const EDITION_FEED_PATH = '/edition';
const EDITION_FOLDER = 'Edition';
const MAX_HTML_BYTES = 400_000;
const LETTER_PATH = '/api/ingest/letter';

function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = bearer(request);
  return Boolean(env.RILL_INGEST_TOKEN_HASH && token && (await verifyToken(token, env.RILL_INGEST_TOKEN_HASH)));
}

export async function handleIngestRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === LETTER_PATH) return handleLetter(request, env, clock);
  if (url.pathname !== '/api/ingest/edition') return null;
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, { status: 405 });

  if (!(await authorized(request, env))) return json({ ok: false, code: 'unauthorized' }, { status: 401 });

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

// A newsletter's full text, posted by the Mac Mini from his inbox. It attaches to a feed he already follows: the
// entry with the same title within three days becomes the full letter in place; with no such entry yet, the letter
// lands on its own and is folded into the feed entry when a later post finds one.
async function handleLetter(request: Request, env: Env, clock: Clock): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, { status: 405 });
  if (!(await authorized(request, env))) return json({ ok: false, code: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, code: 'invalid_json' }, { status: 400 });
  }
  const feedUrl = typeof body.feed_url === 'string' ? body.feed_url.trim() : '';
  const messageId = typeof body.message_id === 'string' ? body.message_id.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const canonicalUrl = typeof body.canonical_url === 'string' && /^https?:\/\//.test(body.canonical_url) ? body.canonical_url : null;
  const publishedAt = typeof body.published_at === 'number' && Number.isFinite(body.published_at) ? Math.floor(body.published_at) : clock();
  if (!feedUrl || !/^[A-Za-z0-9_-]{6,64}$/.test(messageId) || !title || !html) {
    return json({ ok: false, code: 'invalid_letter', message: 'Needs feed_url, message_id, title and html.' }, { status: 400 });
  }
  if (html.length > MAX_HTML_BYTES) return json({ ok: false, code: 'too_large' }, { status: 413 });

  const userId = env.RILL_INGEST_USER_ID ?? 'user-1';
  const user = await getUserById(env.DB, userId);
  if (!user) return json({ ok: false, code: 'user_not_found' }, { status: 404 });
  const feed = await feedByUrl(env.DB, feedUrl);
  if (!feed || !(await isSubscribed(env.DB, user.id, feed.id))) {
    return json({ ok: false, code: 'feed_not_followed', message: 'Rill does not follow that feed.' }, { status: 404 });
  }

  const now = clock();
  const sanitized = sanitizeFeedHtml(html, { baseUrl: feed.site_url ?? feedUrl });
  const text = htmlToPlainText(sanitized);
  const hasImages = /<img\b/i.test(sanitized) ? 1 as const : 0 as const;
  const stableId = `letter:${messageId}`;
  const standaloneId = entryId(feed.id, stableId);

  // The feed's own entry wins over a standalone copy of the same letter.
  const near = await entriesNear(env.DB, feed.id, publishedAt);
  const feedEntry = matchingEntry(near.filter((entry) => !entry.stable_external_id.startsWith('letter:')), title);
  if (feedEntry) {
    const content = { summary_text: text.slice(0, 280), content_text: text, content_html_sanitized: sanitized, has_remote_images: hasImages };
    await upgradeEntryWithLetter(env.DB, feedEntry.id, { ...content, content_hash: letterContentHash({ title: feedEntry.title, ...content }) }, now);
    const standalone = near.find((entry) => entry.id === standaloneId);
    if (standalone) await foldStandaloneLetter(env.DB, user.id, standalone.id, feedEntry.id, now);
    return json({ ok: true, mode: 'upgraded', entry_id: feedEntry.id, folded: Boolean(standalone) });
  }

  const entry = {
    stable_external_id: stableId,
    canonical_url: canonicalUrl,
    title,
    author: null,
    published_at: publishedAt,
    updated_at_feed: now,
    summary_text: text.slice(0, 280),
    content_text: text,
    content_html_sanitized: sanitized,
    content_html_raw: null,
    has_remote_images: hasImages
  };
  await upsertEntry(env.DB, { ...entry, id: standaloneId, feed_id: feed.id, content_hash: letterContentHash(entry), created_at: now, updated_at: now });
  return json({ ok: true, mode: 'inserted', entry_id: standaloneId });
}
