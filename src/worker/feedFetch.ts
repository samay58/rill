import { parseFeed } from '../shared/feed/parse';
import type { FetchRunStatus } from '../shared/types';
import type { Clock } from '../shared/time';
import { systemClock } from '../shared/time';
import { getFeedById, recordFetchRun, updateFeedFetchMetadata, updateRefreshQueueState, upsertEntry } from './db';
import type { Env } from './env';

export interface FetchAndStoreOptions {
  fetcher?: typeof fetch;
  clock?: Clock;
}

export interface FetchAndStoreResult {
  status: FetchRunStatus;
  entriesUpserted: number;
  httpStatus: number | null;
}

export function entryId(feedId: string, stableExternalId: string): string {
  return `entry:${feedId}:${stableExternalId}`;
}

function textHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}


export async function storeParsedFeedEntries(env: Env, feedId: string, parsed: ReturnType<typeof parseFeed>, fetchedAt: number): Promise<number> {
  for (const entry of parsed.entries) {
    await upsertEntry(env.DB, {
      id: entryId(feedId, entry.stable_external_id),
      feed_id: feedId,
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
      content_hash: textHash(`${entry.title ?? ''}|${entry.content_text ?? ''}|${entry.content_html_sanitized ?? ''}`),
      created_at: fetchedAt,
      updated_at: fetchedAt
    });
  }
  return parsed.entries.length;
}

function nextPoll(now: number, status: FetchRunStatus): number {
  if (status === 'ok' || status === 'not_modified') return now + 30 * 60 * 1000;
  return now + 60 * 60 * 1000;
}

async function finishRun(env: Env, run: { id: string; feedId: string; startedAt: number }, status: FetchRunStatus, now: number, httpStatus: number | null, bytesReceived: number | null, errorCode: string | null, errorDetail: string | null): Promise<FetchAndStoreResult> {
  await recordFetchRun(env.DB, {
    id: run.id,
    feed_id: run.feedId,
    started_at: run.startedAt,
    finished_at: now,
    status,
    http_status: httpStatus,
    bytes_received: bytesReceived,
    error_code: errorCode,
    error_detail: errorDetail
  });
  await updateRefreshQueueState(env.DB, run.feedId, {
    next_poll_at: nextPoll(now, status),
    last_polled_at: now,
    last_success_at: status === 'ok' || status === 'not_modified' ? now : null,
    failure_count: status === 'ok' || status === 'not_modified' ? 0 : 1
  });
  return { status, entriesUpserted: 0, httpStatus };
}

export async function fetchAndStoreFeed(env: Env, feedId: string, options: FetchAndStoreOptions = {}): Promise<FetchAndStoreResult> {
  const clock = options.clock ?? systemClock;
  const fetcher = options.fetcher ?? fetch;
  const startedAt = clock();
  const run = { id: crypto.randomUUID(), feedId, startedAt };
  const feed = await getFeedById(env.DB, feedId);
  if (!feed) return finishRun(env, run, 'invalid', clock(), null, null, 'feed_not_found', `Feed ${feedId} was not found.`);

  try {
    const headers = new Headers({ accept: 'application/feed+json, application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.5' });
    if (feed.etag) headers.set('if-none-match', feed.etag);
    if (feed.last_modified) headers.set('if-modified-since', feed.last_modified);

    const response = await fetcher(feed.canonical_feed_url, { headers });
    const now = clock();
    if (response.status === 304) {
      return finishRun(env, run, 'not_modified', now, 304, 0, null, null);
    }
    if (!response.ok) {
      return finishRun(env, run, 'http_error', now, response.status, null, 'http_error', `Feed returned ${response.status}.`);
    }

    const body = await response.text();
    let parsed;
    try {
      parsed = parseFeed(body, response.headers.get('content-type') ?? '', feed.canonical_feed_url);
    } catch (error) {
      return finishRun(env, run, 'parse_error', clock(), response.status, body.length, 'parse_error', error instanceof Error ? error.message : 'Could not parse feed.');
    }

    const fetchedAt = clock();
    await updateFeedFetchMetadata(env.DB, feed.id, {
      title: parsed.title,
      description: parsed.description,
      language: parsed.language,
      site_url: parsed.site_url,
      etag: response.headers.get('etag'),
      last_modified: response.headers.get('last-modified'),
      updated_at: fetchedAt
    });

    await storeParsedFeedEntries(env, feed.id, parsed, fetchedAt);

    await recordFetchRun(env.DB, {
      id: run.id,
      feed_id: feed.id,
      started_at: startedAt,
      finished_at: fetchedAt,
      status: 'ok',
      http_status: response.status,
      bytes_received: body.length,
      error_code: null,
      error_detail: null
    });
    await updateRefreshQueueState(env.DB, feed.id, {
      next_poll_at: nextPoll(fetchedAt, 'ok'),
      last_polled_at: fetchedAt,
      last_success_at: fetchedAt,
      failure_count: 0
    });
    return { status: 'ok', entriesUpserted: parsed.entries.length, httpStatus: response.status };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    return finishRun(env, run, isTimeout ? 'timeout' : 'http_error', clock(), null, null, isTimeout ? 'timeout' : 'fetch_error', error instanceof Error ? error.message : 'Fetch failed.');
  }
}
