import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Entry, EntryUserState, Feed, Subscription, UnixMs } from '../shared/types';

export const RILL_STORE_NAMES = ['subscriptions', 'feeds', 'entries', 'entryState', 'pendingMutations', 'appMeta', 'searchIndexMeta'] as const;
export type StoreName = typeof RILL_STORE_NAMES[number];

export interface PendingEntryMutation {
  entry_id: string;
  read?: boolean;
  saved?: boolean;
  archived?: boolean;
  updated_at_client: UnixMs;
  queued_at: UnixMs;
  attempts: number;
}

export interface AppMetaRecord<T = unknown> {
  key: string;
  value: T;
  updated_at: UnixMs;
}

export interface SearchIndexMetaRecord<T = unknown> {
  key: string;
  value: T;
  updated_at: UnixMs;
}

interface RillDbSchema extends DBSchema {
  subscriptions: { key: string; value: Subscription; indexes: { updated_at: UnixMs } };
  feeds: { key: string; value: Feed; indexes: { updated_at: UnixMs } };
  entries: { key: string; value: Entry; indexes: { feed_id: string; updated_at: UnixMs } };
  entryState: { key: string; value: EntryUserState; indexes: { updated_at: UnixMs } };
  pendingMutations: { key: string; value: PendingEntryMutation; indexes: { updated_at_client: UnixMs } };
  appMeta: { key: string; value: AppMetaRecord };
  searchIndexMeta: { key: string; value: SearchIndexMetaRecord };
}

export interface LocalStore {
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put<T extends object>(store: StoreName, value: T): Promise<void>;
  putMany<T extends object>(store: StoreName, values: T[]): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

const RILL_DB_NAME = 'rill-local-cache';
const RILL_DB_VERSION = 1;

type LooseIdb = {
  getAll(store: string): Promise<unknown[]>;
  get(store: string, key: IDBValidKey): Promise<unknown | undefined>;
  put(store: string, value: unknown): Promise<IDBValidKey>;
  delete(store: string, key: IDBValidKey): Promise<void>;
  clear(store: string): Promise<void>;
};

export class IndexedDbLocalStore implements LocalStore {
  constructor(private readonly db: IDBPDatabase<RillDbSchema>) {}

  async getAll<T>(store: StoreName): Promise<T[]> {
    return (await this.loose().getAll(store)) as T[];
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return (await this.loose().get(store, key)) as T | undefined;
  }

  async put<T extends object>(store: StoreName, value: T): Promise<void> {
    await this.loose().put(store, value);
  }

  async putMany<T extends object>(store: StoreName, values: T[]): Promise<void> {
    for (const value of values) await this.put(store, value);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await this.loose().delete(store, key);
  }

  async clear(store: StoreName): Promise<void> {
    await this.loose().clear(store);
  }

  private loose(): LooseIdb {
    return this.db as unknown as LooseIdb;
  }
}

type IndexableStore = { createIndex(name: string, keyPath: string): unknown };

function createStore(db: IDBPDatabase<RillDbSchema>, name: StoreName, keyPath: string): IndexableStore | null {
  if (db.objectStoreNames.contains(name)) return null;
  return db.createObjectStore(name, { keyPath }) as unknown as IndexableStore;
}

export async function openRillDb(name = RILL_DB_NAME): Promise<IDBPDatabase<RillDbSchema>> {
  return openDB<RillDbSchema>(name, RILL_DB_VERSION, {
    upgrade(db) {
      const subscriptions = createStore(db, 'subscriptions', 'id');
      subscriptions?.createIndex('updated_at', 'updated_at');
      const feeds = createStore(db, 'feeds', 'id');
      feeds?.createIndex('updated_at', 'updated_at');
      const entries = createStore(db, 'entries', 'id');
      entries?.createIndex('feed_id', 'feed_id');
      entries?.createIndex('updated_at', 'updated_at');
      const entryState = createStore(db, 'entryState', 'entry_id');
      entryState?.createIndex('updated_at', 'updated_at');
      const pendingMutations = createStore(db, 'pendingMutations', 'entry_id');
      pendingMutations?.createIndex('updated_at_client', 'updated_at_client');
      createStore(db, 'appMeta', 'key');
      createStore(db, 'searchIndexMeta', 'key');
    }
  });
}

export async function openRillLocalStore(name?: string): Promise<LocalStore> {
  return new IndexedDbLocalStore(await openRillDb(name));
}

export async function setMetaValue<T>(store: LocalStore, key: string, value: T, updatedAt: UnixMs): Promise<void> {
  await store.put<AppMetaRecord<T>>('appMeta', { key, value, updated_at: updatedAt });
}

export async function getMetaValue<T>(store: LocalStore, key: string): Promise<T | null> {
  const record = await store.get<AppMetaRecord<T>>('appMeta', key);
  return record ? record.value : null;
}
