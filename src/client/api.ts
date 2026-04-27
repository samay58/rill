import type { BootstrapPayload, EntryStatePatch, EntryUserState, Subscription, SyncPayload, UnixMs } from '../shared/types';

export interface UnlockResult {
  ok: true;
  user: { id: string; handle: string };
}

export interface ApiFailure {
  ok: false;
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface DiscoveredFeedChoice {
  title: string | null;
  type: 'rss' | 'atom' | 'json';
  url: string;
}

export type AddSourceResult =
  | { ok: true; kind: 'created'; subscription: { feed_id: string; title: string | null; url: string } }
  | { ok: true; kind: 'choices'; choices: DiscoveredFeedChoice[] };

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    return {
      ok: false,
      code: response.status === 401 ? 'unauthorized' : 'invalid_response',
      message: response.statusText || 'Request failed.'
    } as T;
  }
}

function apiError(response: Response, failure: ApiFailure, fallback: string): ApiRequestError {
  return new ApiRequestError(response.status, failure.code, failure.message || fallback);
}

export async function unlock(token: string): Promise<UnlockResult> {
  const response = await fetch('/api/auth/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token })
  });
  const payload = await parseJson<UnlockResult | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Unlock failed.');
  }
  return payload;
}

export async function addSource(url: string): Promise<AddSourceResult> {
  const response = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ url })
  });
  const payload = await parseJson<AddSourceResult | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not add that source.');
  }
  return payload;
}

type BootstrapResponse = BootstrapPayload & { ok: true };
type SyncResponse = SyncPayload & { ok: true };
type EntryStateResponse = { ok: true; state: EntryUserState } | { ok: true; data: EntryUserState };

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  const response = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  const payload = await parseJson<BootstrapResponse | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not load Rill.');
  }
  const { ok: _ok, ...data } = payload as BootstrapResponse;
  return data;
}

export async function fetchSyncSince(cursor: UnixMs): Promise<SyncPayload> {
  const response = await fetch(`/api/sync?since=${encodeURIComponent(String(cursor))}`, { credentials: 'same-origin' });
  const payload = await parseJson<SyncResponse | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not sync Rill.');
  }
  const { ok: _ok, ...data } = payload as SyncResponse;
  return data;
}

export async function patchEntryState(entryId: string, patch: EntryStatePatch): Promise<EntryUserState> {
  const response = await fetch(`/api/entries/${encodeURIComponent(entryId)}/state`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch)
  });
  const payload = await parseJson<EntryStateResponse | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not update that entry.');
  }
  return 'state' in payload ? payload.state : payload.data;
}


export async function patchSubscription(subscriptionId: string, patch: { folder?: string | null; sort_order?: number; is_archived?: 0 | 1 }): Promise<Subscription> {
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch)
  });
  const payload = await parseJson<{ ok: true; subscription: Subscription } | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not update that source.');
  }
  return payload.subscription;
}

export async function removeSubscription(subscriptionId: string): Promise<void> {
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE', credentials: 'same-origin' });
  const payload = await parseJson<{ ok: true; removed: true } | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not remove that source.');
  }
}

export async function refreshSubscription(subscriptionId: string): Promise<void> {
  const response = await fetch(`/api/subscriptions/${encodeURIComponent(subscriptionId)}/refresh`, { method: 'POST', credentials: 'same-origin' });
  const payload = await parseJson<{ ok: true } | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not refresh that source.');
  }
}

export async function refreshAllSubscriptions(): Promise<void> {
  const response = await fetch('/api/refresh', { method: 'POST', credentials: 'same-origin' });
  const payload = await parseJson<{ ok: true } | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not refresh sources.');
  }
}

export async function importOpml(text: string): Promise<{ imported: number; skipped: number }> {
  const response = await fetch('/api/subscriptions/import-opml', {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8' },
    credentials: 'same-origin',
    body: text
  });
  const payload = await parseJson<{ ok: true; imported: number; skipped: number } | ApiFailure>(response);
  if (!response.ok || !payload.ok) {
    throw apiError(response, payload as ApiFailure, 'Could not import OPML.');
  }
  return { imported: payload.imported, skipped: payload.skipped };
}
