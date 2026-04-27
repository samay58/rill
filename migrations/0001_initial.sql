PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE feeds (
  id TEXT PRIMARY KEY,
  canonical_feed_url TEXT NOT NULL UNIQUE,
  site_url TEXT,
  discovered_from_url TEXT,
  feed_type TEXT NOT NULL CHECK (feed_type IN ('rss', 'atom', 'json')),
  title TEXT,
  description TEXT,
  language TEXT,
  etag TEXT,
  last_modified TEXT,
  icon_url TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  folder TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  stable_external_id TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT,
  author TEXT,
  published_at INTEGER,
  updated_at_feed INTEGER,
  summary_text TEXT,
  content_text TEXT,
  content_html_sanitized TEXT,
  content_html_raw TEXT,
  has_remote_images INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (feed_id, stable_external_id),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE entry_user_state (
  user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  read_at INTEGER,
  saved_at INTEGER,
  archived_at INTEGER,
  last_opened_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, entry_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE TABLE feed_fetch_runs (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok', 'not_modified', 'http_error', 'parse_error', 'invalid', 'timeout')),
  http_status INTEGER,
  bytes_received INTEGER,
  error_code TEXT,
  error_detail TEXT,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE feed_refresh_queue_state (
  feed_id TEXT PRIMARY KEY,
  next_poll_at INTEGER NOT NULL,
  last_polled_at INTEGER,
  last_success_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user_expires ON sessions(user_id, expires_at);
CREATE INDEX idx_subscriptions_user_archived ON subscriptions(user_id, is_archived, sort_order);
CREATE INDEX idx_entries_feed_published ON entries(feed_id, published_at DESC);
CREATE INDEX idx_entries_updated ON entries(updated_at);
CREATE INDEX idx_entry_user_state_updated ON entry_user_state(user_id, updated_at);
CREATE INDEX idx_feed_refresh_next_poll ON feed_refresh_queue_state(next_poll_at);
