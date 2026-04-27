---
type: "spec"
scope: "Rill personal reader alpha"
status: "approved 2026-04-27"
owner: "samay"
related:
  - "docs/specs/2026-04-27-rill-paper-brief.md"
---

# Rill Design Spec

Rill is a calm reader for chosen sources.

The covenant comes first:

- You choose the sources.
- Sessions are finite.
- The product does not manipulate you into staying.
- There is no ranking model, no recommendation loop, no generated-summary sludge, and no ad-tech surface.
- The product should feel private, local-first, and respectful of the original writing.

This document is intentionally decision-complete for a later coding pass. It should be possible to build V1 from this without inventing major behavior later.

## 1. Thesis

Most feed readers are either power-user utilities or engagement machines in disguise. Rill should feel like neither.

Rill is for a person who already knows what they want to read. The product job is not discovery, growth hacking, or optimization. The product job is to make a small, high-trust reading ritual feel easy: add good sources, come in, read what is new, save what matters, leave.

The soul is closer to a notebook or a quiet desk than a dashboard.

## 2. Product stance

### What Rill is

- A private personal feed reader
- A reading tool, not a creator economy surface
- A finite-session app for chosen sources
- A syncable local-first web app that works well installed as a PWA

### What Rill is not

- Not a social product
- Not a recommendation engine
- Not a summary wrapper around other people’s writing
- Not a read-it-later warehouse for the whole web
- Not a push-notification habit machine
- Not a full-text extraction pipeline in V1
- Not an analytics product

## 3. MVP boundaries

### In scope for V1

- RSS, Atom, and JSON Feed ingestion
- Feed autodiscovery from a site URL
- OPML import and export
- Private auth for one user with a schema that supports many users later
- Local IndexedDB cache for fast boot and offline reopen
- Cloudflare Worker backend with D1 persistence
- Scheduled refresh via Cron and background fanout via Queues
- Manual refresh for a source or all stale sources
- Today view
- Reader view
- Sources management
- Local search across cached entries
- Read, save, archive, unread state
- PWA installability and offline reopen
- Strict privacy defaults
- Remote images hidden by default, with authenticated proxy loading when requested

### Explicitly out of scope for V1

- Generated summaries
- Recommendations, ranking, clustering, or smart resurfacing
- Push notifications
- Watched keywords or alerts
- Full-text extraction from article pages
- Full-text extraction is a Phase 2 candidate only, and only if it can be added without turning Rill into a scraping warehouse
- Social sharing, follows, comments, likes, or reactions
- Usage analytics or third-party telemetry
- External fonts
- Third-party scripts
- UI component libraries
- Fake thumbnails or scraped preview cards

## 4. Core loop

1. Open Rill.
2. See a finite set of unread items from chosen sources.
3. Open an item.
4. Read feed-provided content in a calm reader.
5. Save it, archive it, or open the original.
6. Leave when done.

There should be no sense that the app is trying to keep the user inside it.

## 5. Primary surfaces

### 5.1 Today

Today is the default surface.

Behavior:

- Shows unread, unarchived entries from subscribed sources
- Reverse chronological by published date
- Grouped lightly by day, not by engagement score or source prestige
- Loads in finite pages of 25 entries at a time
- No infinite auto-load; older items require explicit action
- Ends with a clear “caught up” state
- Saved items do not get special promotion in Today unless they are still unread

List row contents:

- source name
- entry title
- timestamp
- optional short excerpt from feed-provided summary or sanitized text
- saved marker if applicable
- no remote thumbnails by default

### 5.2 Reader

Reader opens from Today, Search, or Sources.

Behavior:

- Marks item read on open
- Offers explicit actions for Save, Archive, Mark unread, Open original
- Renders sanitized feed-provided HTML when present
- Falls back to feed-provided plain text when HTML is absent
- Always keeps a prominent “Open Original” action
- Never attempts article extraction in V1

Image behavior:

- Remote images are hidden by default
- If hidden images exist, show an honest placeholder such as “3 remote images hidden”
- User can choose “Load images for this entry” or “Load images this session”
- Loaded images must come through an authenticated backend proxy so CSP stays strict and the browser never hits third-party image hosts directly

### 5.3 Sources

Sources is the management surface, not the main reading loop.

Behavior:

- List subscribed feeds with title, site URL, last refresh state, unread count
- Allow add, archive, unarchive, remove, and manual refresh
- Allow OPML import and export
- Allow basic ordering or foldering for the source list itself
- Settings may live here or behind a lightweight secondary entry, but Settings is not a primary reading destination

### 5.4 Search

Search is local-first and runs against cached entries.

Behavior:

- Search title, source title, author, and cached text excerpt/body
- Return results instantly from local cache
- Work offline for whatever has already been synced locally
- No semantic search, no embeddings, no automated query rewrite

## 6. Exact MVP behavior

### 6.1 Unlock and auth

V1 is a personal alpha for one human.

Auth model:

- Server has one seeded user row
- That user has one long random private token
- First launch presents a single unlock field
- Client posts token once to the backend
- Backend validates the token and issues a signed, httpOnly session cookie
- Subsequent API requests use the session cookie, not the raw token

Multi-user-ready constraint:

- All user-owned tables include `user_id`
- Auth/session code should not assume global singleton state even though only one user exists in V1

### 6.2 Add Source

User can paste either a direct feed URL or a normal site URL.

If direct feed URL:

- Fetch URL
- Detect RSS, Atom, or JSON Feed
- Validate basic structure
- Subscribe immediately if valid

If site URL:

- Fetch page HTML
- Discover `<link rel="alternate">` entries for RSS, Atom, and JSON Feed
- Prefer `application/feed+json`, then Atom, then RSS when multiple equally plausible feeds exist
- If one clear feed exists, subscribe directly
- If multiple plausible feeds exist, show a chooser with title + URL

Allowed small sample:

- Add Source may show one static example like Opt Out Project
- This is illustrative only
- It is not a recommendation engine and should not evolve into one

### 6.3 Refresh behavior

Refresh paths:

- Manual refresh now
- Refresh one source
- Scheduled background refresh

Scheduling:

- Worker Cron runs every 30 minutes UTC
- Cron enqueues stale feeds into Cloudflare Queues
- Queue consumers fetch feeds with concurrency limits and retries
- Per-feed `next_poll_at` is derived from recent success, server hints like `ttl`, and a minimum poll floor
- Minimum normal poll floor: 15 minutes
- Maximum idle poll window for active subscriptions: 12 hours

Conditional requests:

- Persist and reuse `ETag` and `Last-Modified`
- Correctly handle `304 Not Modified`
- Do not rewrite entry timestamps or unread state on a 304

### 6.4 Entry identity and dedupe

Stable identity precedence:

1. RSS `guid` when present
2. Atom `id`
3. JSON Feed `id`
4. canonicalized entry URL/permalink
5. synthetic hash of `feed_id + normalized title + published_at`

Deduping rules:

- Dedupe within a feed by stable identity
- If the same entry reappears with updated content, update the existing row
- Never create duplicate rows on repeated fetches
- Cross-feed dedupe is out of scope for V1

### 6.5 Read, save, archive semantics

State is per user, per entry.

- `read`: item has been opened or explicitly marked read
- `saved`: item is kept for later reference
- `archived`: item is hidden from normal reading surfaces
- `unread`: implemented by clearing `read_at`

Rules:

- Save is orthogonal to read
- Archive hides an item from Today and Saved defaults but the item remains searchable
- Mark unread clears `read_at` without touching `saved_at`
- State changes apply locally first and sync to the server when possible

### 6.6 Offline behavior

Local-first expectations:

- App shell loads offline
- Last synced Today list opens offline
- Reader opens cached entries offline
- Save/archive/read/unread actions queue offline and reconcile later
- Adding a brand-new source offline is not supported in V1

Offline queue rules:

- Queue idempotent final-state mutations, not toggles
- Replay in order when connectivity returns
- Last write wins by server `updated_at`

### 6.7 OPML import/export

Import:

- Accept standard subscription-list OPML
- Preserve folder/group structure when present
- Ignore unsupported presentation metadata
- Skip duplicates cleanly
- Surface invalid outlines with actionable error copy

Export:

- Export current active subscriptions as standards-compliant OPML
- Include title/text/xmlUrl
- Include htmlUrl when known

### 6.8 Search

Search index is built from locally cached data.

Indexed fields:

- source title
- entry title
- author
- summary text
- sanitized content text excerpt

V1 search must be fast on a personal library and work without hitting the network.

## 7. Architecture

### 7.1 Deployment shape

- Frontend: installable web app, TypeScript, local-first cache, hand-rolled UI
- Backend: Cloudflare Worker API
- Durable storage: Cloudflare D1
- Background fanout: Cloudflare Queues
- Scheduling: Cloudflare Cron Triggers
- Local client cache: IndexedDB

### 7.2 Rendering and dependency stance

Allowed classes of dependency:

- feed parsing utilities
- HTML sanitization library
- small IndexedDB helper
- PWA/service worker tooling if bundled into the app build

Disallowed product-layer dependency classes:

- UI component libraries
- analytics SDKs
- ad or growth SDKs
- externally hosted font kits
- client-loaded third-party scripts

### 7.3 Sync model

Boot order:

1. Load app shell
2. Load cached subscriptions, entries, and state from IndexedDB
3. Render immediately
4. Fetch delta updates from server
5. Merge and re-render quietly

Write path:

1. Apply change locally
2. Enqueue sync op if offline or if request fails
3. Send final-state mutation to server when possible
4. Server persists and returns canonical state
5. Client reconciles if needed

## 8. Data model

### 8.1 D1 schema

#### `users`

- `id` text primary key
- `handle` text unique
- `token_hash` text not null
- `created_at` integer not null
- `updated_at` integer not null

V1 seed row count: exactly one.

#### `sessions`

- `id` text primary key
- `user_id` text not null
- `expires_at` integer not null
- `created_at` integer not null
- `last_seen_at` integer not null

#### `feeds`

- `id` text primary key
- `canonical_feed_url` text unique not null
- `site_url` text
- `discovered_from_url` text
- `feed_type` text not null check in (`rss`,`atom`,`json`)
- `title` text
- `description` text
- `language` text
- `etag` text
- `last_modified` text
- `icon_url` text
- `updated_at` integer not null
- `created_at` integer not null

#### `subscriptions`

- `id` text primary key
- `user_id` text not null
- `feed_id` text not null
- `folder` text
- `sort_order` integer not null default 0
- `is_archived` integer not null default 0
- `created_at` integer not null
- `updated_at` integer not null
- unique (`user_id`, `feed_id`)

#### `entries`

- `id` text primary key
- `feed_id` text not null
- `stable_external_id` text not null
- `canonical_url` text
- `title` text
- `author` text
- `published_at` integer
- `updated_at_feed` integer
- `summary_text` text
- `content_text` text
- `content_html_sanitized` text
- `content_html_raw` text
- `has_remote_images` integer not null default 0
- `content_hash` text
- `created_at` integer not null
- `updated_at` integer not null
- unique (`feed_id`, `stable_external_id`)

`content_html_raw` may be stored for debugging and future migration, but it is never rendered directly.

#### `entry_user_state`

- `user_id` text not null
- `entry_id` text not null
- `read_at` integer
- `saved_at` integer
- `archived_at` integer
- `last_opened_at` integer
- `updated_at` integer not null
- primary key (`user_id`, `entry_id`)

#### `feed_fetch_runs`

- `id` text primary key
- `feed_id` text not null
- `started_at` integer not null
- `finished_at` integer
- `status` text not null check in (`ok`,`not_modified`,`http_error`,`parse_error`,`invalid`,`timeout`)
- `http_status` integer
- `bytes_received` integer
- `error_code` text
- `error_detail` text

#### `feed_refresh_queue_state`

- `feed_id` text primary key
- `next_poll_at` integer not null
- `last_polled_at` integer
- `last_success_at` integer
- `failure_count` integer not null default 0

### 8.2 IndexedDB stores

- `subscriptions`
- `feeds`
- `entries`
- `entryState`
- `searchIndexMeta`
- `pendingMutations`
- `appMeta`

Local cache should keep enough entry text and sanitized HTML for a good offline reopen experience.

## 9. Feed parsing and normalization

### 9.1 Supported formats

- RSS 2.x and common namespace extensions
- Atom
- JSON Feed 1.x/1.1

### 9.2 Normalization rules

- Normalize feed URLs and entry URLs by stripping fragments and common tracking params where safe
- Preserve original source URLs separately when useful for debugging
- Parse dates conservatively; if entry date is missing, fall back to fetch time and mark it as inferred
- Respect feed-provided HTML as source material, but sanitize before storage/render
- Preserve plain-text fallback whenever possible

### 9.3 Sanitization rules

- Sanitize all HTML before storing `content_html_sanitized`
- Allow safe structural markup, links, lists, blockquotes, inline emphasis, and code
- Strip scripts, inline event handlers, dangerous URLs, iframes, embeds, forms, and unknown active content
- No unsanitized HTML may ever be mounted into the DOM

## 10. API surface

All routes are same-origin under `/api`.

### Auth

- `POST /api/auth/unlock`
  - body: `{ token: string }`
  - success: sets session cookie, returns `{ ok: true, user: { id, handle } }`

- `POST /api/auth/logout`
  - clears session cookie

### Bootstrap + sync

- `GET /api/bootstrap`
  - returns subscriptions, light feed metadata, recent entries, user state, server time
  - used after first auth or cold install

- `GET /api/sync?since=<unix_ms>`
  - returns changed subscriptions, entries, and state since cursor

### Source management

- `POST /api/subscriptions`
  - body: `{ url: string }`
  - accepts site URL or feed URL
  - returns discovered choices or created subscription

- `POST /api/subscriptions/import-opml`
  - multipart or text upload
  - returns counts and any skipped duplicates

- `GET /api/subscriptions/export.opml`
  - returns OPML file

- `PATCH /api/subscriptions/:id`
  - body: `{ folder?, sort_order?, is_archived? }`

- `DELETE /api/subscriptions/:id`
  - unsubscribe

### Reading surfaces

- `GET /api/entries?view=today&cursor=<cursor>&limit=25`
- `GET /api/entries/:id`
- `GET /api/search?q=<query>`

### State mutation

- `PATCH /api/entries/:id/state`
  - body: `{ read?, saved?, archived?, updated_at_client }`
  - semantics are final-state, not toggle events

### Refresh

- `POST /api/refresh`
  - refresh all stale subscriptions

- `POST /api/subscriptions/:id/refresh`
  - refresh one source

### Images

- `GET /api/image?entry_id=<id>&src=<encoded_url>`
  - authenticated
  - validates that the URL is one of the entry’s discovered remote images
  - fetches, caches, and returns safe image bytes with strict content-type checks

## 11. Privacy and security

### 11.1 Product privacy defaults

- Private by default
- No analytics SDK
- No ad pixels
- No third-party scripts
- No external font fetches
- No browser requests from the client directly to remote image hosts during normal reading

### 11.2 Content security policy

Target CSP posture:

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'` for MVP if needed, later tighten with nonce/hashes
- `img-src 'self' data: blob:`
- `connect-src 'self'`
- `font-src 'self'`
- `frame-src 'none'`
- `object-src 'none'`
- `base-uri 'self'`
- `form-action 'self'`

### 11.3 Proxy rules for remote images

- Only authenticated clients can request proxied images
- Only `http` and `https` source URLs allowed
- Reject localhost, private-network, and non-image content types
- Enforce byte cap and timeout
- Strip cookies and referrer
- Cache proxied responses on the backend where possible

### 11.4 Storage rules

- Token stored only as a hash on the server
- Session cookie is signed, httpOnly, secure, same-site strict or lax depending on install constraints
- IndexedDB stores reading cache and per-entry state only
- No sensitive secrets in client bundle

## 12. Visual direction

Rill should feel like a quiet reading instrument.

Design principles:

- warm but restrained
- typography-forward without depending on external fonts
- clear hierarchy, low chrome, no decorative clutter
- native-feeling interactions on desktop and mobile
- no emoji UI
- no gradients
- no metric dashboarding
- no dopamine badges beyond honest state markers like saved/unread
- no fake thumbnails

The object should feel easier to trust than a typical reader.

## 13. Build phases

### Phase 0: approval

- approve spec
- approve Paper directions

### Phase 1: shell and auth

- app shell
- unlock flow
- session handling
- D1 schema
- IndexedDB bootstrap

### Phase 2: ingestion and sync

- add source
- autodiscovery
- parser normalization
- manual refresh
- cron + queue refresh
- delta sync

### Phase 3: reading loop

- Today
- Reader
- read/save/archive/unread
- offline queue
- local search

### Phase 4: source management and export

- Sources
- OPML import/export
- source archive/remove
- final polish and PWA install review

## 14. Acceptance tests

These are required fixture and behavior tests for V1.

### 14.1 Feed fixture tests

1. RSS feed with GUIDs creates stable entry IDs from GUID
2. RSS feed without GUIDs falls back to permalink or synthetic key without duplicate explosions
3. Atom feed parses `id`, `updated`, and content correctly
4. JSON Feed parses `id`, `content_html` or `content_text`, and metadata correctly
5. Feed autodiscovery finds alternate feed links from a normal site URL
6. Conditional GET returning `304` leaves entry/state rows unchanged while updating fetch-run status appropriately
7. Malformed XML yields a failed fetch-run without corrupting existing entries
8. Unsafe feed HTML is sanitized and never rendered unsafely
9. OPML import accepts a standard subscription list and skips duplicates cleanly
10. OPML export round-trips into import without losing subscribed feeds
11. Re-fetching unchanged or slightly edited feeds dedupes correctly
12. Offline action queue replays read/save/archive changes correctly after reconnect

### 14.2 Manual acceptance scenario

The user must be able to do all of the following on a real build:

1. unlock the app with the private token
2. subscribe to Opt Out Project directly or through discovery
3. paste another normal site URL and successfully discover its feed
4. open Today and read new items
5. save one item
6. mark one item read and another archived
7. trigger a scheduled or manual refresh and see new content sync in
8. reopen the app offline and still read previously cached items
9. export subscriptions to OPML and re-import them without duplication
10. confirm in DevTools that there are no third-party scripts, no external fonts, and no analytics calls

## 15. Definition of done for MVP

Rill V1 is done when:

- the full chosen-source reading loop works without invention or apology
- adding feeds is reliable across RSS, Atom, JSON Feed, and normal-site autodiscovery
- Today feels finite and calm
- Reader is trustworthy and keeps Open Original obvious
- state changes sync reliably and work offline
- OPML round-trip works
- privacy defaults are actually enforced, not just described
- the product feels like a personal reading tool, not a feed casino

## 16. Open questions intentionally deferred

These are real questions, but not blockers for V1:

- whether Saved deserves a first-class top-level surface or a mode inside Today/Search
- whether source folders should affect Today filtering in V1 or stay management-only
- whether image loading preference should support per-source allowlists later
- whether full-text extraction should exist at all in Phase 2, even though it is technically possible

## 17. Source notes

Light implementation notes, not heavy inline citations:

- Cloudflare Workers Cron Triggers, D1, and Queues are the intended backend primitives.
- IndexedDB and PWA installability/offline behavior should follow MDN guidance.
- CSP and CORS posture should follow MDN guidance and stay strict.
- Web Push exists on Apple platforms for Home Screen web apps, but push is explicitly out of scope for V1.
- Feed compatibility should align with RSS 2.0, Atom, JSON Feed 1.1, and common OPML subscription-list conventions.
- HTML sanitization should use a mature sanitizer such as DOMPurify rather than ad hoc allowlists.

Reference links:

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
- MDN IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- MDN CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- MDN CSP: https://developer.mozilla.org/docs/Web/HTTP/Guides/CSP
- MDN PWA overview: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
- MDN PWA installability: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- WebKit Web Push on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- RSS 2.0: https://www.rssboard.org/rss-specification
- Atom RFC 4287: https://www.rfc-editor.org/rfc/rfc4287.html
- JSON Feed 1.1: https://www.jsonfeed.org/version/1.1
- OPML 2.0: https://2005.opml.org/spec2.html
- DOMPurify: https://github.com/cure53/DOMPurify
