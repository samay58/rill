import { discoverFeedsFromHtml, isLikelyFeedContentType, type DiscoveredFeed } from '../../shared/feed/discover';
import { parseFeed } from '../../shared/feed/parse';
import { storeParsedFeedEntries } from '../feedFetch';
import { canonicalizeUrl } from '../../shared/url';
import { requireUser } from '../auth';
import { createSubscription, deleteSubscription, listEntriesForUser, listEntryStateForUser, listFeedsForUser, listSubscriptions, patchSubscription, updateRefreshQueueState, upsertFeed, type SubscriptionPatch } from '../db';
import type { Env } from '../env';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function routeUser(request: Request, env: Env, clock: Clock) {
  try {
    return await requireUser(request, env, clock);
  } catch (error) {
    if (error instanceof Response) {
      return json({ ok: false, code: 'unauthorized', message: await error.text() || 'Unauthorized' }, { status: error.status });
    }
    throw error;
  }
}

function feedIdFromUrl(url: string): string {
  return `feed:${url}`;
}

function subscriptionId(userId: string, feedId: string): string {
  return `sub:${userId}:${feedId}`;
}

function choicesResponse(choices: DiscoveredFeed[]): Response {
  return json({ ok: true, kind: 'choices', choices });
}

function parseSubscriptionPatch(body: Record<string, unknown>): SubscriptionPatch {
  const patch: SubscriptionPatch = {};
  if (body.folder === null || typeof body.folder === 'string') patch.folder = body.folder;
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) patch.sort_order = Math.floor(body.sort_order);
  if (body.is_archived === 0 || body.is_archived === 1 || typeof body.is_archived === 'boolean') patch.is_archived = body.is_archived === true ? 1 : body.is_archived === false ? 0 : body.is_archived;
  return patch;
}

async function createSubscriptionFromFeed(env: Env, userId: string, url: string, body: string, contentType: string, discoveredFromUrl: string | null, now: number): Promise<Response> {
  const canonicalFeedUrl = canonicalizeUrl(url);
  const parsed = parseFeed(body, contentType, canonicalFeedUrl);
  const feedId = feedIdFromUrl(canonicalFeedUrl);
  await upsertFeed(env.DB, {
    id: feedId,
    canonical_feed_url: canonicalFeedUrl,
    site_url: parsed.site_url,
    discovered_from_url: discoveredFromUrl,
    feed_type: parsed.feed_type,
    title: parsed.title,
    description: parsed.description,
    language: parsed.language,
    etag: null,
    last_modified: null,
    icon_url: null,
    created_at: now,
    updated_at: now
  });
  await createSubscription(env.DB, {
    id: subscriptionId(userId, feedId),
    user_id: userId,
    feed_id: feedId,
    folder: null,
    sort_order: 0,
    is_archived: 0,
    created_at: now,
    updated_at: now
  });
  await storeParsedFeedEntries(env, feedId, parsed, now);
  await updateRefreshQueueState(env.DB, feedId, {
    next_poll_at: now + 30 * 60 * 1000,
    last_polled_at: now,
    last_success_at: now,
    failure_count: 0
  });
  return json({ ok: true, kind: 'created', subscription: { feed_id: feedId, title: parsed.title, url: canonicalFeedUrl } });
}

async function handleCreateSubscription(request: Request, env: Env, clock: Clock): Promise<Response> {
  const user = await routeUser(request, env, clock);
  if (user instanceof Response) return user;
  const body = await readJsonBody(request);
  const inputUrl = typeof body.url === 'string' ? body.url.trim() : '';
  if (!inputUrl) return json({ ok: false, code: 'missing_url', message: 'Paste a site or feed URL.' }, { status: 400 });

  let url: string;
  try {
    url = new URL(inputUrl).toString();
  } catch {
    return json({ ok: false, code: 'invalid_url', message: 'Enter a valid URL including https://.' }, { status: 400 });
  }

  const fetched = await fetch(url, { headers: { accept: 'application/feed+json, application/atom+xml, application/rss+xml, text/html, application/xml;q=0.9, */*;q=0.5' } });
  if (!fetched.ok) return json({ ok: false, code: 'fetch_failed', message: `Could not fetch that URL (${fetched.status}).` }, { status: 422 });
  const contentType = fetched.headers.get('content-type') ?? '';
  const text = await fetched.text();
  const now = clock();

  if (isLikelyFeedContentType(contentType)) {
    try {
      return await createSubscriptionFromFeed(env, user.id, url, text, contentType, null, now);
    } catch {
      const choices = discoverFeedsFromHtml(text, url);
      if (choices.length > 0) return choices.length === 1
        ? await createSubscriptionFromDiscoveredChoice(env, user.id, choices[0], url, now)
        : choicesResponse(choices);
      return json({ ok: false, code: 'invalid_feed', message: 'That URL did not look like a valid RSS, Atom, or JSON Feed.' }, { status: 422 });
    }
  }

  const choices = discoverFeedsFromHtml(text, url);
  if (choices.length === 0) return json({ ok: false, code: 'no_feed_found', message: 'No feed link was found on that page.' }, { status: 422 });
  if (choices.length > 1) return choicesResponse(choices);
  return createSubscriptionFromDiscoveredChoice(env, user.id, choices[0], url, now);
}

async function createSubscriptionFromDiscoveredChoice(env: Env, userId: string, choice: DiscoveredFeed, discoveredFromUrl: string, now: number): Promise<Response> {
  const fetched = await fetch(choice.url, { headers: { accept: 'application/feed+json, application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.5' } });
  if (!fetched.ok) return json({ ok: false, code: 'feed_fetch_failed', message: `Found a feed but could not fetch it (${fetched.status}).` }, { status: 422 });
  return createSubscriptionFromFeed(env, userId, choice.url, await fetched.text(), fetched.headers.get('content-type') ?? '', discoveredFromUrl, now);
}

export async function handleSubscriptionsRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const serverTime = clock();
    const [feeds, subscriptions, entries, entryState] = await Promise.all([
      listFeedsForUser(env.DB, user.id),
      listSubscriptions(env.DB, user.id),
      listEntriesForUser(env.DB, user.id),
      listEntryStateForUser(env.DB, user.id)
    ]);
    return json({ ok: true, user, feeds, subscriptions, entries, entryState, serverTime, syncCursor: serverTime });
  }
  if (url.pathname === '/api/sync' && request.method === 'GET') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const since = Number(url.searchParams.get('since') ?? 0);
    const cursor = Number.isFinite(since) ? since : 0;
    const serverTime = clock();
    const [feeds, subscriptions, entries, entryState] = await Promise.all([
      listFeedsForUser(env.DB, user.id, cursor),
      listSubscriptions(env.DB, user.id, cursor),
      listEntriesForUser(env.DB, user.id, 100, cursor),
      listEntryStateForUser(env.DB, user.id, cursor)
    ]);
    return json({ ok: true, feeds, subscriptions, entries, entryState, serverTime, syncCursor: serverTime });
  }
  if (url.pathname === '/api/subscriptions' && request.method === 'POST') {
    return handleCreateSubscription(request, env, clock);
  }
  const subscriptionMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (subscriptionMatch && request.method === 'PATCH') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const subscription = await patchSubscription(env.DB, user.id, decodeURIComponent(subscriptionMatch[1]), parseSubscriptionPatch(await readJsonBody(request)), clock());
    if (!subscription) return json({ ok: false, code: 'subscription_not_found', message: 'Source not found.' }, { status: 404 });
    return json({ ok: true, subscription });
  }
  if (subscriptionMatch && request.method === 'DELETE') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const removed = await deleteSubscription(env.DB, user.id, decodeURIComponent(subscriptionMatch[1]));
    if (!removed) return json({ ok: false, code: 'subscription_not_found', message: 'Source not found.' }, { status: 404 });
    return json({ ok: true, removed: true });
  }
  return null;
}
