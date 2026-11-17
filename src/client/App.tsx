import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppView } from './design';
import { extractEntryContent, importOpml, patchSubscription as patchRemoteSubscription, refreshAllSubscriptions, refreshSubscription, removeSubscription } from './api';
import { getMetaValue, type LocalStore, openRillLocalStore } from './db';
import { defaultSyncApi, loadCachedState, queueEntryStateMutation, replayPendingMutations, syncSince, bootstrapFromServer, type CachedClientState, type RillSyncApi } from './sync';
import type { Entry, EntryStatePatch, EntryUserState, Feed, Subscription, UnixMs } from '../shared/types';
import { cleanLine } from '../shared/displayText';
import { AddSourceView } from './views/AddSourceView';
import { ReaderView } from './views/ReaderView';
import { SavedView } from './views/SavedView';
import { Shell } from './views/Shell';
import { SourcesView, type SourceViewModel } from './views/SourcesView';
import { ReadingEntry, TodayView } from './views/TodayView';
import { UnlockView } from './views/UnlockView';
import { isEdition } from './views/readingDay';
import { canLoadFullArticle } from './views/readerContent';
import { SearchView } from './views/SearchView';

type AppRoute = AppView | `reader:${string}`;

interface AppProps {
  initialUnlocked?: boolean;
  initialEntries?: ReadingEntry[];
  clock?: () => number;
  localStore?: LocalStore;
  syncApi?: RillSyncApi;
}

function routeToView(route: AppRoute, readerFrom: AppView = 'today'): AppView {
  return route.startsWith('reader:') ? readerFrom : route as AppView;
}

const READER_HASH = '#read/';

function readerHashId(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  return hash.startsWith(READER_HASH) ? decodeURIComponent(hash.slice(READER_HASH.length)) : null;
}

function selectedEntryId(route: AppRoute): string | null {
  return route.startsWith('reader:') ? route.slice('reader:'.length) : null;
}

// Rows stored before the parser cleaned titles still hold raw feed text (`&#8217;`, doubled spaces); clean on the way in.
function presentEntry<T extends Pick<Entry, 'title' | 'author'>>(entry: T): T {
  return { ...entry, title: cleanLine(entry.title), author: cleanLine(entry.author) };
}

function entriesFromCache(cache: CachedClientState): ReadingEntry[] {
  const subscriptionTitles = new Map(cache.subscriptions.map((subscription) => [subscription.feed_id, subscription.title ?? null]));
  const feedTitles = new Map(cache.feeds.map((feed) => [feed.id, subscriptionTitles.get(feed.id) ?? feed.title]));
  const stateByEntry = new Map(cache.entryState.map((state) => [state.entry_id, state]));
  const activeFeeds = new Set(cache.subscriptions.filter((subscription) => subscription.is_archived === 0).map((subscription) => subscription.feed_id));
  return cache.entries
    .filter((entry) => activeFeeds.has(entry.feed_id))
    .map((entry) => {
      const state = stateByEntry.get(entry.id);
      return {
        ...presentEntry(entry),
        source_title: cleanLine(feedTitles.get(entry.feed_id)),
        read_at: state?.read_at ?? null,
        saved_at: state?.saved_at ?? null,
        archived_at: state?.archived_at ?? null,
        last_opened_at: state?.last_opened_at ?? null
      };
    });
}

// Coming back to Rill after this long fetches what arrived meanwhile, so the list is never stale on return.
const CATCH_UP_AFTER_MS = 90 * 1000;
// The cached list shows before the server answers only if this device reached the server lately. A phone left
// unopened for weeks (or a session that may have ended) confirms with the server first, as every open used to.
const TRUST_CACHE_FOR_MS = 14 * 24 * 60 * 60 * 1000;
const LAST_OK_KEY = 'rill:last-server-ok';

function lastServerOk(): number {
  try { return Number(window.localStorage.getItem(LAST_OK_KEY)) || 0; } catch { return 0; }
}

function markServerOk() {
  try { window.localStorage.setItem(LAST_OK_KEY, String(Date.now())); } catch { /* private mode: every open confirms first */ }
}

function withStates(entries: ReadingEntry[], states: EntryUserState[]): ReadingEntry[] {
  const byEntry = new Map(states.map((state) => [state.entry_id, state]));
  return entries.map((entry) => {
    const state = byEntry.get(entry.id);
    if (!state) return entry;
    return { ...entry, read_at: state.read_at, saved_at: state.saved_at, archived_at: state.archived_at, last_opened_at: state.last_opened_at };
  });
}

function isAuthFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 401;
}

function sourceRows(feeds: Feed[], subscriptions: Subscription[], entries: ReadingEntry[], refreshingSourceIds: Set<string>): SourceViewModel[] {
  const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
  return subscriptions.map((subscription) => {
    const feed = feedById.get(subscription.feed_id);
    const unreadCount = entries.filter((entry) => entry.feed_id === subscription.feed_id && entry.read_at === null && entry.archived_at === null).length;
    return {
      id: subscription.id,
      title: cleanLine(subscription.title) ?? cleanLine(feed?.title) ?? feed?.canonical_feed_url ?? 'Untitled source',
      url: feed?.canonical_feed_url ?? subscription.feed_id,
      siteUrl: feed?.site_url ?? null,
      updatedAt: feed?.updated_at ?? subscription.updated_at,
      unreadCount,
      isArchived: subscription.is_archived === 1,
      isRefreshing: refreshingSourceIds.has(subscription.id)
    };
  });
}

function entryRowFromReadingEntry(entry: ReadingEntry): Entry {
  return {
    id: entry.id,
    feed_id: entry.feed_id,
    stable_external_id: entry.stable_external_id,
    canonical_url: entry.canonical_url,
    title: entry.title,
    author: entry.author,
    published_at: entry.published_at,
    updated_at_feed: entry.updated_at_feed,
    summary_text: entry.summary_text,
    content_text: entry.content_text,
    content_html_sanitized: entry.content_html_sanitized,
    content_html_raw: entry.content_html_raw,
    has_remote_images: entry.has_remote_images,
    content_hash: entry.content_hash,
    created_at: entry.created_at,
    updated_at: entry.updated_at
  };
}

function mergeExtractedEntry(current: ReadingEntry, extracted: ReadingEntry): ReadingEntry {
  return {
    ...current,
    ...presentEntry(entryRowFromReadingEntry(extracted)),
    source_title: current.source_title ?? cleanLine(extracted.source_title),
    read_at: current.read_at,
    saved_at: current.saved_at,
    archived_at: current.archived_at,
    last_opened_at: current.last_opened_at
  };
}

export function App({ initialUnlocked = false, initialEntries = [], clock = () => Date.now(), localStore, syncApi = defaultSyncApi }: AppProps) {
  const [isUnlocked, setIsUnlocked] = useState(initialUnlocked);
  const [route, setRoute] = useState<AppRoute>('today');
  // Where Reader was opened from, so Back returns there and the sidebar keeps that view lit.
  const [readerFrom, setReaderFrom] = useState<AppView>('today');
  // Scroll position per list view. The page itself scrolls, so without this a return from Reader landed at the
  // top of Today, and Reader opened wherever the list had been scrolled to (Nov 16 2026).
  const scrollMemory = useRef<Partial<Record<AppView, number>>>({});
  const routeRef = useRef<AppRoute>('today');
  routeRef.current = route;
  const readerFromRef = useRef<AppView>('today');
  readerFromRef.current = readerFrom;
  const [entries, setEntries] = useState<ReadingEntry[]>(initialEntries);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [runtimeStore, setRuntimeStore] = useState<LocalStore | null>(localStore ?? null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<string>>(() => new Set());
  const [extractingEntryIds, setExtractingEntryIds] = useState<Set<string>>(() => new Set());
  const [extractionErrors, setExtractionErrors] = useState<Record<string, string>>({});
  const shouldAutoSync = initialEntries.length === 0 || Boolean(localStore);
  const [isCheckingSession, setIsCheckingSession] = useState(!initialUnlocked && shouldAutoSync);
  const lastSyncAt = useRef(0); // when the server last answered a sync, by `clock`
  const catchingUp = useRef(false);
  const cacheShown = useRef(false); // the device's own copy has been drawn once

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

  async function finishUnlock() {
    const store = runtimeStore ?? localStore ?? await openRillLocalStore();
    setRuntimeStore(store);
    applyCached(await bootstrapFromServer(store, syncApi));
    lastSyncAt.current = clock();
    cacheShown.current = true;
    markServerOk();
    setIsUnlocked(true);
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
    if (isUnlocked || !shouldAutoSync) {
      setIsCheckingSession(false);
      return;
    }
    let cancelled = false;

    async function checkExistingSession() {
      const store = localStore ?? await openRillLocalStore();
      if (cancelled) return;
      setRuntimeStore(store);
      const cached = await loadCachedState(store);
      if (cancelled) return;
      // Open on what this device already holds and let the catch-up below talk to the server. Every cold open used to
      // wait for the full 1.2 MB snapshot before drawing a row (Nov 16 2026: 1.5 s on wifi, seconds on a phone).
      if (cached.userId && (cached.entries.length > 0 || cached.subscriptions.length > 0) && Date.now() - lastServerOk() < TRUST_CACHE_FOR_MS) {
        cacheShown.current = true;
        applyCached(cached);
        setIsUnlocked(true);
        setIsCheckingSession(false);
        return;
      }
      try {
        const serverCache = await bootstrapFromServer(store, syncApi);
        if (cancelled) return;
        lastSyncAt.current = clock();
        markServerOk();
        applyCached(serverCache);
        setIsUnlocked(true);
      } catch (error) {
        if (isAuthFailure(error)) return;
        if (!cancelled && cached.userId && (cached.entries.length > 0 || cached.subscriptions.length > 0)) {
          applyCached(cached);
          setIsUnlocked(true);
        }
      } finally {
        if (!cancelled) setIsCheckingSession(false);
      }
    }

    void checkExistingSession().catch(() => {
      if (!cancelled) setIsCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isUnlocked, localStore, shouldAutoSync, syncApi]);

  // Send queued read/save marks, then fetch only what changed since the last sync. Runs once after unlock and again
  // whenever Rill comes back to the foreground after a while (an iPhone PWA resumes rather than reloads, so before Nov 16
  // 2026 new stories waited for a manual refresh). A 401 means the session ended: show the unlock screen.
  async function catchUp(store: LocalStore) {
    if (catchingUp.current) return;
    catchingUp.current = true;
    try {
      await replayPendingMutations(store, syncApi);
      const cursor = await getMetaValue<UnixMs>(store, 'syncCursor');
      const now = clock();
      // A delta when there is a cursor; the full snapshot only for a first sync. Refresh still takes a full one.
      if (!cursor) {
        applyCached(await bootstrapFromServer(store, syncApi));
      } else {
        const payload = await syncSince(store, cursor, syncApi);
        const changed = payload.entries.length + payload.entryState.length + payload.feeds.length + payload.subscriptions.length > 0;
        if (changed) applyCached(await loadCachedState(store));
      }
      lastSyncAt.current = now;
      markServerOk();
    } catch (error) {
      if (isAuthFailure(error)) setIsUnlocked(false);
    } finally {
      catchingUp.current = false;
    }
  }

  useEffect(() => {
    if (!isUnlocked || !shouldAutoSync) return;
    let cancelled = false;
    let store: LocalStore | null = runtimeStore ?? localStore ?? null;
    async function begin() {
      store ??= await openRillLocalStore();
      if (cancelled) return;
      setRuntimeStore(store);
      // Draw what the device holds before any network, unless the session check above already did.
      if (!cacheShown.current) {
        const cached = await loadCachedState(store);
        if (cancelled) return;
        if (cached.userId || cached.entries.length > 0) applyCached(cached);
        cacheShown.current = true;
      }
      // A first unlock has just taken the snapshot; it needs no second trip.
      if (clock() - lastSyncAt.current > 15_000) await catchUp(store);
    }
    void begin().catch(() => undefined);
    function onReturn() {
      if (document.visibilityState !== 'visible' || !store) return;
      if (clock() - lastSyncAt.current > CATCH_UP_AFTER_MS) void catchUp(store);
    }
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('online', onReturn);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('online', onReturn);
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
    // Only the read/saved/archived marks can change here, so only they are read back. Reloading the whole store after
    // each tap parsed every cached article again.
    void queueEntryStateMutation(store, currentUserId, entryId, { ...patch, updated_at_client }, clock)
      .then(() => replayPendingMutations(store, syncApi))
      .then(() => store.getAll<EntryUserState>('entryState'))
      .then((states) => setEntries((current) => withStates(current, states)))
      .catch(() => undefined);
  }

  // Workbench links to rill/#edition: open the newest Morning Edition once entries load.
  const editionHashHandled = useRef(false);
  useEffect(() => {
    if (editionHashHandled.current || !isUnlocked || typeof window === 'undefined') return;
    if (window.location.hash !== '#edition') return;
    const editions = entries.filter(isEdition);
    if (editions.length === 0) return;
    editionHashHandled.current = true;
    const newest = editions.reduce((best, entry) => ((entry.published_at ?? 0) > (best.published_at ?? 0) ? entry : best));
    window.history.replaceState(null, '', window.location.pathname);
    openEntry(newest.id);
  }, [entries, isUnlocked]);

  function rememberScroll() {
    const current = routeRef.current;
    if (typeof window === 'undefined' || current.startsWith('reader:')) return;
    scrollMemory.current[current as AppView] = window.scrollY;
  }

  function showReader(entryId: string) {
    rememberScroll();
    const current = routeRef.current;
    if (!current.startsWith('reader:')) setReaderFrom(current as AppView);
    setRoute(`reader:${entryId}`);
  }

  function openEntry(entryId: string) {
    updateEntry(entryId, (entry, now) => ({
      ...entry,
      read_at: entry.read_at ?? now,
      last_opened_at: now,
      updated_at: now
    }));
    persistEntryPatch(entryId, { read: true });
    // Reader gets its own history entry, so the browser's Back (a swipe on the iPhone) returns to the list
    // instead of leaving Rill.
    if (typeof window !== 'undefined' && readerHashId() !== entryId) {
      const hash = `${READER_HASH}${encodeURIComponent(entryId)}`;
      if (readerHashId() === null) window.history.pushState({ rillReader: entryId }, '', hash);
      else window.history.replaceState({ rillReader: entryId }, '', hash);
    }
    showReader(entryId);
  }

  function toggleRead(entryId: string) {
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry) return;
    const read = entry.read_at === null;
    updateEntry(entryId, (current, now) => ({ ...current, read_at: read ? now : null, updated_at: now }));
    persistEntryPatch(entryId, { read });
  }

  function navigate(view: AppView) {
    rememberScroll();
    // Leaving Reader by a tab drops its history entry, so a later Back does not reopen the article.
    if (typeof window !== 'undefined' && readerHashId() !== null) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setRoute(view);
  }

  const closeReaderRef = useRef<() => void>(() => undefined);
  function closeReader() {
    const from = readerFrom;
    if (typeof window !== 'undefined' && readerHashId() !== null) {
      if (window.history.state?.rillReader) window.history.back();
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setRoute(from);
  }

  closeReaderRef.current = closeReader;

  // Browser Back and Forward move between the list and Reader.
  useEffect(() => {
    if (!isUnlocked || typeof window === 'undefined') return;
    function onPopState() {
      const entryId = readerHashId();
      if (entryId) {
        if (routeRef.current !== `reader:${entryId}`) showReader(entryId);
      } else if (routeRef.current.startsWith('reader:')) {
        setRoute((current) => (current.startsWith('reader:') ? readerFromRef.current : current));
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isUnlocked]);
  // A link or reload on #read/<id> opens that entry once it is loaded, with the list one Back away.
  const readerHashHandled = useRef(false);
  useEffect(() => {
    if (readerHashHandled.current || !isUnlocked || typeof window === 'undefined') return;
    const entryId = readerHashId();
    if (!entryId) { readerHashHandled.current = true; return; }
    if (!entries.some((entry) => entry.id === entryId)) return;
    readerHashHandled.current = true;
    const path = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', path);
    window.history.pushState({ rillReader: entryId }, '', `${READER_HASH}${encodeURIComponent(entryId)}`);
    showReader(entryId);
  }, [entries, isUnlocked]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
    try {
      if (route.startsWith('reader:')) window.scrollTo(0, 0);
      else window.scrollTo(0, scrollMemory.current[route as AppView] ?? 0);
    } catch {
      // jsdom has no scrolling
    }
  }, [route]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  async function loadFullArticle(entryId: string) {
    setExtractionErrors((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    setExtractingEntryIds((current) => new Set(current).add(entryId));
    try {
      const extractedEntry = await extractEntryContent(entryId);
      setEntries((current) => current.map((entry) => entry.id === entryId ? mergeExtractedEntry(entry, extractedEntry) : entry));
      const store = runtimeStore;
      if (store) await store.put('entries', entryRowFromReadingEntry(extractedEntry));
    } catch (error) {
      setExtractionErrors((current) => ({
        ...current,
        [entryId]: error instanceof Error ? error.message : 'Could not load the full article.'
      }));
    } finally {
      setExtractingEntryIds((current) => {
        const next = new Set(current);
        next.delete(entryId);
        return next;
      });
    }
  }

  // Keys for reading at the desk: j and k move through the list, Enter opens, Escape goes back, s saves,
  // m flips read, o opens the original. Ignored while typing. Each acts on what is on screen, nothing else.
  useEffect(() => {
    if (!isUnlocked || typeof window === 'undefined') return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      const reading = routeRef.current.startsWith('reader:');
      const entryId = reading ? routeRef.current.slice('reader:'.length) : null;
      if (reading) {
        if (event.key === 'Escape' || event.key === 'u') { event.preventDefault(); closeReaderRef.current(); }
        else if (event.key === 's' && entryId) { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-action="save-entry"]')?.click(); }
        else if (event.key === 'm' && entryId) { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-action="mark-unread"]')?.click(); }
        else if (event.key === 'o') { document.querySelector<HTMLAnchorElement>('[data-action="open-original"]')?.click(); }
        return;
      }
      if (event.key !== 'j' && event.key !== 'k' && event.key !== 'm') return;
      const rows = [...document.querySelectorAll<HTMLButtonElement>('.entry-open-button')];
      if (rows.length === 0) return;
      const at = rows.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'm') {
        if (at >= 0) { event.preventDefault(); rows[at].closest('.entry-row')?.querySelector<HTMLButtonElement>('.entry-dot-button')?.click(); }
        return;
      }
      event.preventDefault();
      const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (event.key === 'j' ? 1 : -1)));
      rows[next].focus({ preventScroll: true });
      rows[next].scrollIntoView({ block: 'nearest' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isUnlocked]);

  // A teaser fetches its full article the moment it opens, once per visit, instead of waiting on a button.
  const autoFetched = useRef<Set<string>>(new Set());
  const openId = selectedEntryId(route);
  useEffect(() => {
    if (!openId || autoFetched.current.has(openId)) return;
    const entry = entries.find((candidate) => candidate.id === openId);
    if (!entry || !canLoadFullArticle(entry)) return;
    autoFetched.current.add(openId);
    void loadFullArticle(openId);
  }, [openId, entries]);

  if (isCheckingSession) {
    return (
      <main className="unlock-shell" aria-label="Opening Rill">
        <div className="unlock-card">
          <div className="unlock-wordmark">rill</div>
        </div>
      </main>
    );
  }

  if (!isUnlocked) return <UnlockView onUnlocked={finishUnlock} />;

  const selectedId = selectedEntryId(route);
  const selectedEntry = selectedId ? entries.find((entry) => entry.id === selectedId) ?? null : null;
  const activeView = routeToView(route, readerFrom);
  const unreadCount = entries.filter((entry) => entry.read_at === null && entry.archived_at === null).length;

  return (
    <Shell activeView={activeView} unreadCount={unreadCount} onNavigate={navigate}>
      {route === 'today' ? <TodayView entries={entries} onOpenEntry={openEntry} onToggleRead={toggleRead} onSearch={() => navigate('search')} onRefresh={refreshEverything} isRefreshing={isRefreshingAll} now={clock()} /> : null}
      {route === 'saved' ? <SavedView entries={entries} onOpenEntry={openEntry} /> : null}
      {route === 'search' ? <SearchView entries={entries} onOpenEntry={openEntry} /> : null}
      {route === 'sources' ? (
        <SourcesView
          sources={sourceRows(feeds, subscriptions, entries, refreshingSourceIds)}
          onAddSource={() => navigate('add-source')}
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
          backLabel={readerFrom === 'saved' ? 'Saved' : readerFrom === 'search' ? 'Search' : 'Today'}
          onBack={closeReader}
          onSave={(entryId) => {
            updateEntry(entryId, (entry, now) => ({ ...entry, saved_at: entry.saved_at ?? now, updated_at: now }));
            persistEntryPatch(entryId, { saved: true });
          }}
          onArchive={(entryId) => {
            updateEntry(entryId, (entry, now) => ({ ...entry, archived_at: now, updated_at: now }));
            persistEntryPatch(entryId, { archived: true });
            closeReader();
          }}
          onMarkUnread={(entryId) => {
            updateEntry(entryId, (entry, now) => ({ ...entry, read_at: null, updated_at: now }));
            persistEntryPatch(entryId, { read: false });
          }}
          onLoadFullArticle={(entryId) => { void loadFullArticle(entryId); }}
          isLoadingFullArticle={extractingEntryIds.has(selectedEntry.id)}
          fullArticleError={extractionErrors[selectedEntry.id]}
        />
      ) : null}
    </Shell>
  );
}
