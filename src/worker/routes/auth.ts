import { createExpiredSessionCookie, unlockWithToken } from '../auth';
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

export async function handleAuthRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/auth/unlock' && request.method === 'POST') {
    const body = await readJsonBody(request);
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token.trim()) return json({ ok: false, code: 'missing_token', message: 'Enter the private token.' }, { status: 400 });
    try {
      const { user, cookie } = await unlockWithToken(env, token, clock);
      const response = json({ ok: true, user: { id: user.id, handle: user.handle } });
      response.headers.append('set-cookie', cookie);
      return response;
    } catch (error) {
      if (error instanceof Response) {
        return json({ ok: false, code: error.status === 401 ? 'invalid_token' : 'unlock_unavailable', message: await error.text() }, { status: error.status });
      }
      throw error;
    }
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const response = json({ ok: true });
    response.headers.append('set-cookie', createExpiredSessionCookie());
    return response;
  }

  return null;
}
