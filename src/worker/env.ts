export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  REFRESH_QUEUE: Queue;
  RILL_TOKEN_HASH?: string;
  SESSION_SECRET?: string;
}
