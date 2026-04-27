import type { LocalStore, StoreName } from '../../src/client/db';
import { RILL_STORE_NAMES } from '../../src/client/db';

function keyFor(store: StoreName, value: object): IDBValidKey {
  const keyed = value as { id?: string; key?: string; entry_id?: string };
  const key = store === 'entryState' || store === 'pendingMutations'
    ? keyed.entry_id
    : store === 'appMeta' || store === 'searchIndexMeta'
      ? keyed.key
      : keyed.id;
  if (!key) throw new Error(`Missing key for ${store}`);
  return key;
}

export class MemoryStore implements LocalStore {
  private readonly stores = new Map<StoreName, Map<IDBValidKey, unknown>>();

  constructor() {
    for (const store of RILL_STORE_NAMES) this.stores.set(store, new Map());
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return Array.from(this.store(store).values()) as T[];
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.store(store).get(key) as T | undefined;
  }

  async put<T extends object>(store: StoreName, value: T): Promise<void> {
    this.store(store).set(keyFor(store, value), value);
  }

  async putMany<T extends object>(store: StoreName, values: T[]): Promise<void> {
    for (const value of values) await this.put(store, value);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    this.store(store).delete(key);
  }

  async clear(store: StoreName): Promise<void> {
    this.store(store).clear();
  }

  private store(name: StoreName): Map<IDBValidKey, unknown> {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Missing store ${name}`);
    return store;
  }
}
