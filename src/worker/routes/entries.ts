import type { EntryStatePatch } from '../../shared/types';
import type { Clock } from '../../shared/time';
import { systemClock } from '../../shared/time';
import { requireUser } from '../auth';
import { getEntryForUser, listTodayEntries, patchEntryState, searchEntries } from '../db';
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

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseLimit(url: URL, fallback = 25): number {
  const value = Number(url.searchParams.get('limit') ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function parsePatch(body: Record<string, unknown>, clock: Clock): EntryStatePatch {
  const patch: EntryStatePatch = { updated_at_client: typeof body.updated_at_client === 'number' ? body.updated_at_client : clock() };
  if (typeof body.read === 'boolean') patch.read = body.read;
  if (typeof body.saved === 'boolean') patch.saved = body.saved;
  if (typeof body.archived === 'boolean') patch.archived = body.archived;
  return patch;
}

export async function handleEntriesRoute(request: Request, env: Env, clock: Clock = systemClock): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/entries' && request.method === 'GET') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const entries = await listTodayEntries(env.DB, user.id, parseLimit(url));
    return json({ ok: true, entries });
  }

  if (url.pathname === '/api/search' && request.method === 'GET') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const query = (url.searchParams.get('q') ?? '').trim();
    if (!query) return json({ ok: true, entries: [] });
    const entries = await searchEntries(env.DB, user.id, query, parseLimit(url));
    return json({ ok: true, entries });
  }

  const stateMatch = url.pathname.match(/^\/api\/entries\/([^/]+)\/state$/);
  if (stateMatch && request.method === 'PATCH') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const entryId = decodeURIComponent(stateMatch[1]);
    const entry = await getEntryForUser(env.DB, user.id, entryId);
    if (!entry) return json({ ok: false, code: 'entry_not_found', message: 'Entry not found.' }, { status: 404 });
    const state = await patchEntryState(env.DB, user.id, entryId, parsePatch(await readJsonBody(request), clock), clock());
    return json({ ok: true, state });
  }

  const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch && request.method === 'GET') {
    const user = await routeUser(request, env, clock);
    if (user instanceof Response) return user;
    const entry = await getEntryForUser(env.DB, user.id, decodeURIComponent(entryMatch[1]));
    if (!entry) return json({ ok: false, code: 'entry_not_found', message: 'Entry not found.' }, { status: 404 });
    return json({ ok: true, entry });
  }

  return null;
}
