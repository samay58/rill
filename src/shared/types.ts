export type UnixMs = number;
export type FeedType = 'rss' | 'atom' | 'json';
export type FetchRunStatus = 'ok' | 'not_modified' | 'http_error' | 'parse_error' | 'invalid' | 'timeout';

export interface User {
  id: string;
  handle: string;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: UnixMs;
  created_at: UnixMs;
  last_seen_at: UnixMs;
}

export interface Feed {
  id: string;
  canonical_feed_url: string;
  site_url: string | null;
  discovered_from_url: string | null;
  feed_type: FeedType;
  title: string | null;
  description: string | null;
  language: string | null;
  etag: string | null;
  last_modified: string | null;
  icon_url: string | null;
  updated_at: UnixMs;
  created_at: UnixMs;
}

export interface Subscription {
  id: string;
  user_id: string;
  feed_id: string;
  folder: string | null;
  sort_order: number;
  is_archived: 0 | 1;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface Entry {
  id: string;
  feed_id: string;
  stable_external_id: string;
  canonical_url: string | null;
  title: string | null;
  author: string | null;
  published_at: UnixMs | null;
  updated_at_feed: UnixMs | null;
  summary_text: string | null;
  content_text: string | null;
  content_html_sanitized: string | null;
  content_html_raw: string | null;
  has_remote_images: 0 | 1;
  content_hash: string | null;
  created_at: UnixMs;
  updated_at: UnixMs;
}

export interface EntryUserState {
  user_id: string;
  entry_id: string;
  read_at: UnixMs | null;
  saved_at: UnixMs | null;
  archived_at: UnixMs | null;
  last_opened_at: UnixMs | null;
  updated_at: UnixMs;
}

export interface EntryWithState extends Entry {
  source_title: string | null;
  read_at: UnixMs | null;
  saved_at: UnixMs | null;
  archived_at: UnixMs | null;
  last_opened_at: UnixMs | null;
}

export interface EntryStatePatch {
  read?: boolean;
  saved?: boolean;
  archived?: boolean;
  updated_at_client: UnixMs;
}

export interface FeedFetchRun {
  id: string;
  feed_id: string;
  started_at: UnixMs;
  finished_at: UnixMs | null;
  status: FetchRunStatus;
  http_status: number | null;
  bytes_received: number | null;
  error_code: string | null;
  error_detail: string | null;
}

export interface BootstrapPayload {
  user: User;
  feeds: Feed[];
  subscriptions: Subscription[];
  entries: Entry[];
  entryState: EntryUserState[];
  serverTime: UnixMs;
  syncCursor: UnixMs;
}

export interface SyncPayload {
  feeds: Feed[];
  subscriptions: Subscription[];
  entries: Entry[];
  entryState: EntryUserState[];
  serverTime: UnixMs;
  syncCursor: UnixMs;
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export type ApiResult<T> = ApiOk<T> | ApiError;
