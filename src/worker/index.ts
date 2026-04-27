import type { Env } from './env';
import { handleAuthRoute } from './routes/auth';
import { handleSubscriptionsRoute } from './routes/subscriptions';
import { consumeRefreshMessage, enqueueDueFeeds, handleRefreshRoute } from './routes/refresh';
import { handleEntriesRoute } from './routes/entries';
import { handleImageRoute } from './routes/images';
import { handleOpmlRoute } from './routes/opml';

const securityHeaders = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [key, value] of Object.entries(securityHeaders)) {
    secured.headers.set(key, value);
  }
  return secured;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const authResponse = await handleAuthRoute(request, env);
    if (authResponse) return withSecurityHeaders(authResponse);
    const subscriptionsResponse = await handleSubscriptionsRoute(request, env);
    if (subscriptionsResponse) return withSecurityHeaders(subscriptionsResponse);
    const refreshResponse = await handleRefreshRoute(request, env);
    if (refreshResponse) return withSecurityHeaders(refreshResponse);
    const opmlResponse = await handleOpmlRoute(request, env);
    if (opmlResponse) return withSecurityHeaders(opmlResponse);
    const entriesResponse = await handleEntriesRoute(request, env);
    if (entriesResponse) return withSecurityHeaders(entriesResponse);
    const imageResponse = await handleImageRoute(request, env);
    if (imageResponse) return withSecurityHeaders(imageResponse);
    if (url.pathname === '/api/health') {
      return withSecurityHeaders(Response.json({ ok: true }));
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await enqueueDueFeeds(env);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await consumeRefreshMessage(env, message.body);
      message.ack();
    }
  }
};
