import { parseOpmlSubscriptions, renderOpmlSubscriptions } from '../../shared/opml';
import { canonicalizeUrl } from '../../shared/url';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';
import { requireUser } from '../auth';
import { createSubscription, listSubscriptionFeedExports, listSubscriptions, upsertFeed } from '../db';
import type { Env } from '../env';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function routeUser(request: Request, env: Env, clock: Clock) {
  try {
    return await requireUser(request, env, clock);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

function feedIdFromUrl(url: string): string {
  return `feed:${url}`;
}

function subscriptionId(userId: string, feedId: string): string {
  return `sub:${userId}:${feedId}`;
}

export async function handleOpmlRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/subscriptions/export.opml' && request.method === 'GET') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const rows = await listSubscriptionFeedExports(env.DB, user.id);
    const body = renderOpmlSubscriptions(rows.map((row) => ({
      title: row.title ?? row.canonical_feed_url,
      feed_url: row.canonical_feed_url,
      site_url: row.site_url,
      folder: row.folder
    })));
    return new Response(body, {
      headers: {
        'content-type': 'text/x-opml; charset=utf-8',
        'content-disposition': 'attachment; filename="rill-subscriptions.opml"'
      }
    });
  }

  if (url.pathname === '/api/subscriptions/import-opml' && request.method === 'POST') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const imported = parseOpmlSubscriptions(await request.text());
    const existingFeedIds = new Set((await listSubscriptions(env.DB, user.id)).map((subscription) => subscription.feed_id));
    let importedCount = 0;
    let skipped = 0;
    const now = clock();
    for (const item of imported) {
      const feedUrl = canonicalizeUrl(item.feed_url);
      const feedId = feedIdFromUrl(feedUrl);
      if (existingFeedIds.has(feedId)) {
        skipped += 1;
        continue;
      }
      await upsertFeed(env.DB, {
        id: feedId,
        canonical_feed_url: feedUrl,
        site_url: item.site_url,
        discovered_from_url: null,
        feed_type: 'rss',
        title: item.title,
        description: null,
        language: null,
        etag: null,
        last_modified: null,
        icon_url: null,
        created_at: now,
        updated_at: now
      });
      await createSubscription(env.DB, {
        id: subscriptionId(user.id, feedId),
        user_id: user.id,
        feed_id: feedId,
        folder: item.folder,
        sort_order: importedCount,
        is_archived: 0,
        created_at: now,
        updated_at: now
      });
      existingFeedIds.add(feedId);
      importedCount += 1;
    }
    return json({ ok: true, imported: importedCount, skipped });
  }

  return null;
}
