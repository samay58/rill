export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  REFRESH_QUEUE: Queue;
  RILL_TOKEN_HASH?: string;
  SESSION_SECRET?: string;
  ARTICLE_RESOLVER_FALLBACK?: string;
  // SHA-256 hex of the secret the Mini sends when posting Morning Edition.
  RILL_INGEST_TOKEN_HASH?: string;
  RILL_INGEST_USER_ID?: string;
}
