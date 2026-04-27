import { requireUser } from '../auth';
import { fetchAndStoreFeed } from '../feedFetch';
import { listDueFeedIds, listSubscriptions } from '../db';
import type { Env } from '../env';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function queueFeed(env: Env, feedId: string): Promise<void> {
  await env.REFRESH_QUEUE.send({ feedId });
}

async function refreshFeedNow(env: Env, feedId: string): Promise<boolean> {
  const result = await fetchAndStoreFeed(env, feedId);
  return result.status === 'ok' || result.status === 'not_modified';
}

export async function handleRefreshRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/refresh' && request.method === 'POST') {
    const user = await requireUser(request, env, clock);
    const subscriptions = await listSubscriptions(env.DB, user.id);
    const active = subscriptions.filter((subscription) => subscription.is_archived === 0);
    const results = await Promise.all(active.map((subscription) => refreshFeedNow(env, subscription.feed_id)));
    return json({ ok: true, queued: 0, refreshed: results.filter(Boolean).length });
  }

  const match = url.pathname.match(/^\/api\/subscriptions\/([^/]+)\/refresh$/);
  if (match && request.method === 'POST') {
    const user = await requireUser(request, env, clock);
    const subscriptions = await listSubscriptions(env.DB, user.id);
    const subscription = subscriptions.find((candidate) => candidate.id === decodeURIComponent(match[1]));
    if (!subscription || subscription.is_archived === 1) {
      return json({ ok: false, code: 'subscription_not_found', message: 'That source is not active.' }, { status: 404 });
    }
    const refreshed = await refreshFeedNow(env, subscription.feed_id);
    return json({ ok: true, queued: 0, refreshed: refreshed ? 1 : 0 });
  }

  return null;
}

export async function enqueueDueFeeds(env: Env, clock: Clock = systemClock): Promise<number> {
  const feedIds = await listDueFeedIds(env.DB, clock());
  await Promise.all(feedIds.map((feedId) => queueFeed(env, feedId)));
  return feedIds.length;
}

export async function consumeRefreshMessage(env: Env, body: unknown): Promise<void> {
  if (!body || typeof body !== 'object' || typeof (body as { feedId?: unknown }).feedId !== 'string') return;
  await fetchAndStoreFeed(env, (body as { feedId: string }).feedId);
}
