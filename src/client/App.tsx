import { useEffect, useState } from 'react';
import { AppView } from './design';
import { importOpml, patchSubscription as patchRemoteSubscription, refreshAllSubscriptions, refreshSubscription, removeSubscription } from './api';
import { type LocalStore, openRillLocalStore } from './db';
import { defaultSyncApi, loadCachedState, queueEntryStateMutation, replayPendingMutations, syncSince, bootstrapFromServer, type CachedClientState, type RillSyncApi } from './sync';
import type { EntryStatePatch, Feed, Subscription } from '../shared/types';
import { AddSourceView } from './views/AddSourceView';
import { ReaderView } from './views/ReaderView';
import { SavedView } from './views/SavedView';
import { Shell } from './views/Shell';
import { SourcesView, type SourceViewModel } from './views/SourcesView';
import { ReadingEntry, TodayView } from './views/TodayView';
import { UnlockView } from './views/UnlockView';
import { SearchView } from './views/SearchView';

type AppRoute = AppView | `reader:${string}`;

interface AppProps {
  initialUnlocked?: boolean;
  initialEntries?: ReadingEntry[];
  clock?: () => number;
  localStore?: LocalStore;
  syncApi?: RillSyncApi;
}

function routeToView(route: AppRoute): AppView {
  return route.startsWith('reader:') ? 'today' : route as AppView;
}

function selectedEntryId(route: AppRoute): string | null {
  return route.startsWith('reader:') ? route.slice('reader:'.length) : null;
}

function entriesFromCache(cache: CachedClientState): ReadingEntry[] {
  const feedTitles = new Map(cache.feeds.map((feed) => [feed.id, feed.title]));
  const stateByEntry = new Map(cache.entryState.map((state) => [state.entry_id, state]));
  const activeFeeds = new Set(cache.subscriptions.filter((subscription) => subscription.is_archived === 0).map((subscription) => subscription.feed_id));
  return cache.entries
    .filter((entry) => activeFeeds.has(entry.feed_id))
    .map((entry) => {
      const state = stateByEntry.get(entry.id);
      return {
        ...entry,
        source_title: feedTitles.get(entry.feed_id) ?? null,
        read_at: state?.read_at ?? null,
        saved_at: state?.saved_at ?? null,
        archived_at: state?.archived_at ?? null,
        last_opened_at: state?.last_opened_at ?? null
      };
    });
}

function sourceRows(feeds: Feed[], subscriptions: Subscription[], entries: ReadingEntry[], refreshingSourceIds: Set<string>): SourceViewModel[] {
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  return subscriptions.map((subscription) => {
    const feed = feedById.get(subscription.feed_id);
    const unreadCount = entries.filter((entry) => entry.feed_id === subscription.feed_id && entry.read_at === null && entry.archived_at === null).length;
    return {
      id: subscription.id,
      title: feed?.title ?? feed?.canonical_feed_url ?? 'Untitled source',
      url: feed?.canonical_feed_url ?? subscription.feed_id,
      siteUrl: feed?.site_url ?? null,
      updatedAt: feed?.updated_at ?? subscription.updated_at,
      unreadCount,
      isArchived: subscription.is_archived === 1,
      isRefreshing: refreshingSourceIds.has(subscription.id)
    };
  });
}

export function App({ initialUnlocked = false, initialEntries = [], clock = () => Date.now(), localStore, syncApi = defaultSyncApi }: AppProps) {
  const [isUnlocked, setIsUnlocked] = useState(initialUnlocked);
  const [route, setRoute] = useState<AppRoute>('today');
  const [entries, setEntries] = useState<ReadingEntry[]>(initialEntries);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [runtimeStore, setRuntimeStore] = useState<LocalStore | null>(localStore ?? null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<string>>(() => new Set());
  const shouldAutoSync = initialEntries.length === 0 || Boolean(localStore);

  function applyCached(cache: CachedClientState) {
    setEntries(entriesFromCache(cache));
    setFeeds(cache.feeds);
    setSubscriptions(cache.subscriptions);
    setUserId(cache.userId);
  }

  async function refreshFromServer() {
    const store = runtimeStore;
    if (!store) return;
    applyCached(await bootstrapFromServer(store, syncApi));
  }

  async function refreshEverything() {
    setIsRefreshingAll(true);
    try {
      await refreshAllSubscriptions();
      await refreshFromServer();
    } finally {
      setIsRefreshingAll(false);
    }
  }

  async function refreshOneSource(subscriptionId: string) {
    setRefreshingSourceIds((current) => new Set(current).add(subscriptionId));
    try {
      await refreshSubscription(subscriptionId);
      await refreshFromServer();
    } finally {
      setRefreshingSourceIds((current) => {
        const next = new Set(current);
        next.delete(subscriptionId);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!isUnlocked || !shouldAutoSync) return;
    let cancelled = false;

    function applyEffectCache(cache: CachedClientState) {
      if (cancelled) return;
      applyCached(cache);
    }

    async function load() {
      const store = localStore ?? await openRillLocalStore();
      if (cancelled) return;
      setRuntimeStore(store);
      const cached = await loadCachedState(store);
      applyEffectCache(cached);
      await replayPendingMutations(store, syncApi);
      const nextCache = cached.syncCursor === 0
        ? await bootstrapFromServer(store, syncApi)
        : (await syncSince(store, cached.syncCursor, syncApi), await loadCachedState(store));
      applyEffectCache(nextCache);
    }

    void load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isUnlocked, localStore, shouldAutoSync, syncApi]);

  function updateEntry(entryId: string, update: (entry: ReadingEntry, now: number) => ReadingEntry) {
    const now = clock();
    setEntries((current) => current.map((entry) => entry.id === entryId ? update(entry, now) : entry));
  }

  function persistEntryPatch(entryId: string, patch: Omit<EntryStatePatch, 'updated_at_client'>) {
    const store = runtimeStore;
    const currentUserId = userId;
    if (!store || !currentUserId) return;
    const updated_at_client = clock();
    void queueEntryStateMutation(store, currentUserId, entryId, { ...patch, updated_at_client }, clock)
      .then(() => replayPendingMutations(store, syncApi))
      .then(() => loadCachedState(store))
      .then((cache) => {
        setEntries(entriesFromCache(cache));
        setUserId(cache.userId);
      })
      .catch(() => undefined);
  }

  function openEntry(entryId: string) {
    updateEntry(entryId, (entry, now) => ({
      ...entry,
      read_at: entry.read_at ?? now,
      last_opened_at: now,
      updated_at: now
    }));
    persistEntryPatch(entryId, { read: true });
    setRoute(`reader:${entryId}`);
  }

  if (!isUnlocked) return <UnlockView onUnlocked={() => setIsUnlocked(true)} />;

  const selectedId = selectedEntryId(route);
  const selectedEntry = selectedId ? entries.find((entry) => entry.id === selectedId) ?? null : null;
  const activeView = routeToView(route);
  const unreadCount = entries.filter((entry) => entry.read_at === null && entry.archived_at === null).length;

  return (
    <Shell activeView={activeView} unreadCount={unreadCount} onNavigate={setRoute}>
      {route === 'today' ? <TodayView entries={entries} onOpenEntry={openEntry} onSearch={() => setRoute('search')} onRefresh={refreshEverything} isRefreshing={isRefreshingAll} /> : null}
      {route === 'saved' ? <SavedView entries={entries} onOpenEntry={openEntry} /> : null}
      {route === 'search' ? <SearchView entries={entries} onOpenEntry={openEntry} /> : null}
      {route === 'sources' ? (
        <SourcesView
          sources={sourceRows(feeds, subscriptions, entries, refreshingSourceIds)}
          onAddSource={() => setRoute('add-source')}
          onRefreshSource={(subscriptionId) => { void refreshOneSource(subscriptionId).catch(() => undefined); }}
          onArchiveSource={(subscriptionId, archived) => {
            setSubscriptions((current) => current.map((subscription) => subscription.id === subscriptionId ? { ...subscription, is_archived: archived ? 1 : 0, updated_at: clock() } : subscription));
            void patchRemoteSubscription(subscriptionId, { is_archived: archived ? 1 : 0 }).then(() => refreshFromServer()).catch(() => undefined);
          }}
          onRemoveSource={(subscriptionId) => {
            setSubscriptions((current) => current.filter((subscription) => subscription.id !== subscriptionId));
            void removeSubscription(subscriptionId).then(() => refreshFromServer()).catch(() => undefined);
          }}
          onRefreshAll={() => { void refreshEverything().catch(() => undefined); }}
          isRefreshingAll={isRefreshingAll}
          onImportOpml={(text) => importOpml(text).then(() => refreshFromServer())}
        />
      ) : null}
      {route === 'add-source' ? <AddSourceView onSourceAdded={refreshFromServer} /> : null}
      {selectedEntry ? (
        <ReaderView
          entry={selectedEntry}
          onBack={() => setRoute('today')}
          onSave={(entryId) => {
            updateEntry(entryId, (entry, now) => ({ ...entry, saved_at: entry.saved_at ?? now, updated_at: now }));
            persistEntryPatch(entryId, { saved: true });
          }}
          onArchive={(entryId) => {
            updateEntry(entryId, (entry, now) => ({ ...entry, archived_at: now, updated_at: now }));
            persistEntryPatch(entryId, { archived: true });
            setRoute('today');
          }}
          onMarkUnread={(entryId) => {
            updateEntry(entryId, (entry, now) => ({ ...entry, read_at: null, updated_at: now }));
            persistEntryPatch(entryId, { read: false });
          }}
        />
      ) : null}
    </Shell>
  );
}
