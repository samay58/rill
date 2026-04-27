import type { BootstrapPayload, EntryStatePatch, EntryUserState, Entry, Feed, Subscription, SyncPayload, UnixMs } from '../shared/types';
import { systemClock, type Clock } from '../shared/time';
import { fetchBootstrap, fetchSyncSince, patchEntryState as patchRemoteEntryState } from './api';
import { getMetaValue, setMetaValue, type LocalStore, type PendingEntryMutation } from './db';

const SYNC_CURSOR_KEY = 'syncCursor';
const USER_ID_KEY = 'userId';

export interface CachedClientState {
  feeds: Feed[];
  subscriptions: Subscription[];
  entries: Entry[];
  entryState: EntryUserState[];
  pendingMutations: PendingEntryMutation[];
  syncCursor: UnixMs;
  userId: string | null;
}

export interface RillSyncApi {
  bootstrap(): Promise<BootstrapPayload>;
  syncSince(cursor: UnixMs): Promise<SyncPayload>;
  patchEntryState(entryId: string, patch: EntryStatePatch): Promise<EntryUserState>;
}

export const defaultSyncApi: RillSyncApi = {
  bootstrap: fetchBootstrap,
  syncSince: fetchSyncSince,
  patchEntryState: patchRemoteEntryState
};

export async function loadCachedState(store: LocalStore): Promise<CachedClientState> {
  const [feeds, subscriptions, entries, entryState, pendingMutations, syncCursor, userId] = await Promise.all([
    store.getAll<Feed>('feeds'),
    store.getAll<Subscription>('subscriptions'),
    store.getAll<Entry>('entries'),
    store.getAll<EntryUserState>('entryState'),
    store.getAll<PendingEntryMutation>('pendingMutations'),
    getMetaValue<UnixMs>(store, SYNC_CURSOR_KEY),
    getMetaValue<string>(store, USER_ID_KEY)
  ]);
  const inferredUserId = userId ?? subscriptions[0]?.user_id ?? entryState[0]?.user_id ?? null;
  return { feeds, subscriptions, entries, entryState, pendingMutations, syncCursor: syncCursor ?? 0, userId: inferredUserId };
}

async function putServerEntryState(store: LocalStore, state: EntryUserState): Promise<void> {
  const pending = await store.get<PendingEntryMutation>('pendingMutations', state.entry_id);
  if (pending && pending.updated_at_client > state.updated_at) return;
  await store.put<EntryUserState>('entryState', state);
}

async function mergeServerPayload(store: LocalStore, payload: SyncPayload | BootstrapPayload): Promise<void> {
  await Promise.all([
    store.putMany<Feed>('feeds', payload.feeds),
    store.putMany<Subscription>('subscriptions', payload.subscriptions),
    store.putMany<Entry>('entries', payload.entries)
  ]);
  for (const state of payload.entryState) await putServerEntryState(store, state);
  if ('user' in payload) await setMetaValue(store, USER_ID_KEY, payload.user.id, payload.serverTime);
  await setMetaValue(store, SYNC_CURSOR_KEY, payload.syncCursor, payload.serverTime);
}

export async function bootstrapFromServer(store: LocalStore, api: RillSyncApi = defaultSyncApi): Promise<CachedClientState> {
  await mergeServerPayload(store, await api.bootstrap());
  return loadCachedState(store);
}

export async function syncSince(store: LocalStore, cursor: UnixMs, api: RillSyncApi = defaultSyncApi): Promise<SyncPayload> {
  const payload = await api.syncSince(cursor);
  await mergeServerPayload(store, payload);
  return payload;
}

function stateTimestamp(flag: boolean | undefined, timestamp: UnixMs, fallback: UnixMs | null): UnixMs | null {
  if (flag === undefined) return fallback;
  return flag ? timestamp : null;
}

function mergeMutation(existing: PendingEntryMutation | undefined, entryId: string, patch: EntryStatePatch, queuedAt: UnixMs): PendingEntryMutation {
  const mutation: PendingEntryMutation = {
    entry_id: entryId,
    queued_at: existing?.queued_at ?? queuedAt,
    attempts: existing?.attempts ?? 0,
    updated_at_client: patch.updated_at_client
  };
  if (existing?.read !== undefined) mutation.read = existing.read;
  if (existing?.saved !== undefined) mutation.saved = existing.saved;
  if (existing?.archived !== undefined) mutation.archived = existing.archived;
  if (patch.read !== undefined) mutation.read = patch.read;
  if (patch.saved !== undefined) mutation.saved = patch.saved;
  if (patch.archived !== undefined) mutation.archived = patch.archived;
  return mutation;
}

export async function queueEntryStateMutation(
  store: LocalStore,
  userId: string,
  entryId: string,
  patch: EntryStatePatch,
  clock: Clock = systemClock
): Promise<PendingEntryMutation> {
  const queuedAt = clock();
  const existingMutation = await store.get<PendingEntryMutation>('pendingMutations', entryId);
  const mutation = mergeMutation(existingMutation, entryId, patch, queuedAt);
  await store.put<PendingEntryMutation>('pendingMutations', mutation);

  const current = await store.get<EntryUserState>('entryState', entryId);
  await store.put<EntryUserState>('entryState', {
    user_id: current?.user_id ?? userId,
    entry_id: entryId,
    read_at: stateTimestamp(patch.read, patch.updated_at_client, current?.read_at ?? null),
    saved_at: stateTimestamp(patch.saved, patch.updated_at_client, current?.saved_at ?? null),
    archived_at: stateTimestamp(patch.archived, patch.updated_at_client, current?.archived_at ?? null),
    last_opened_at: current?.last_opened_at ?? null,
    updated_at: patch.updated_at_client
  });
  return mutation;
}

function mutationPatch(mutation: PendingEntryMutation): EntryStatePatch {
  const patch: EntryStatePatch = { updated_at_client: mutation.updated_at_client };
  if (mutation.read !== undefined) patch.read = mutation.read;
  if (mutation.saved !== undefined) patch.saved = mutation.saved;
  if (mutation.archived !== undefined) patch.archived = mutation.archived;
  return patch;
}

export async function replayPendingMutations(store: LocalStore, api: RillSyncApi = defaultSyncApi): Promise<{ attempted: number; applied: number; remaining: number }> {
  const pending = (await store.getAll<PendingEntryMutation>('pendingMutations')).sort((left, right) => left.updated_at_client - right.updated_at_client);
  let applied = 0;
  for (const mutation of pending) {
    try {
      const state = await api.patchEntryState(mutation.entry_id, mutationPatch(mutation));
      await store.put<EntryUserState>('entryState', state);
      await store.delete('pendingMutations', mutation.entry_id);
      applied += 1;
    } catch {
      await store.put<PendingEntryMutation>('pendingMutations', { ...mutation, attempts: mutation.attempts + 1 });
      break;
    }
  }
  return { attempted: pending.length, applied, remaining: (await store.getAll<PendingEntryMutation>('pendingMutations')).length };
}
