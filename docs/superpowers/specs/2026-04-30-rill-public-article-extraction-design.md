---
type: "design"
scope: "Rill Reader full-article fallback"
status: "approved 2026-04-30"
owner: "samay"
related:
  - "docs/specs/2026-04-27-rill-design.md"
---

# Rill Public Article Extraction Design

Rill should feel like a reader, not a teaser inbox. When an RSS, Atom, or JSON Feed entry only provides a short summary, Reader should offer a direct way to load the public article body into Rill itself.

The boundary is strict: Rill may fetch the entry's public canonical URL without user cookies, extract readable article content, sanitize it, and cache the result. Rill must not bypass paywalls, use browser session credentials, scrape private subscription content, or hide the fact that extraction failed.

## Product Decision

The current V1 stance says Reader renders feed-provided content and never attempts article extraction. That was conservative, but it breaks the core promise for sources such as Matt Levine's Bloomberg feed, where the feed entry is only a short teaser. The new rule is:

- Feed-provided full content remains the first choice.
- If Reader detects that content is likely a teaser, it shows an explicit "Load full article" action.
- A successful load replaces the teaser with sanitized extracted article content and keeps "Open Original" visible.
- A failed load shows a plain unavailable state and leaves the original link intact.

This keeps Rill centered on chosen sources while making the reading surface useful for excerpt-only feeds.

## Not Building

- No automatic extraction for every new entry in the first pass.
- No paywall bypass or subscriber-cookie use.
- No external article extraction service.
- No generated summaries.
- No semantic cleanup or rewriting.
- No background crawler behavior.
- No per-source extraction settings until the manual path proves reliable.

## Recommended Approach

Add authenticated, same-origin, per-entry extraction behind `POST /api/entries/:id/extract`.

The Worker fetches `entry.canonical_url` with a normal server request, rejects non-public or unsafe URLs, parses the returned HTML with a Worker-compatible DOM parser, runs Mozilla Readability when available, sanitizes the extracted HTML through Rill's existing sanitizer, and stores the result on the existing entry row. Reader then refreshes the entry and renders the cached extracted content. After one successful extraction, offline reopen works from the local IndexedDB cache once sync has pulled the updated entry.

The implementation should first test whether `@mozilla/readability` plus `linkedom` bundles cleanly under the Worker build. If that fails, use a narrower local extractor based on the existing `htmlparser2` stack rather than adding a new service.

## Data Flow

```text
Reader opens entry
  -> entry has only teaser content
  -> user clicks Load full article
  -> client posts to /api/entries/:id/extract
  -> Worker validates ownership and canonical URL
  -> Worker fetches public page without cookies
  -> extractor returns readable HTML and plain text
  -> existing sanitizer removes unsafe markup
  -> D1 entry is updated
  -> client bootstraps or syncs
  -> Reader renders full cached content
```

There is no cycle in the data flow. Reader asks for extraction, the Worker updates the entry, and the normal cache/sync path carries the result back to the client.

## Reader Behavior

Reader needs three clear states:

- `ready`: entry already has enough feed-provided or extracted content, so Reader renders it.
- `loadable`: entry looks like a teaser and has a canonical URL, so Reader shows "Load full article" below the title.
- `unavailable`: extraction was attempted and failed, so Reader explains that the public article could not be loaded.

"Open Original" remains in the toolbar in every state where `canonical_url` exists. It is not a fallback hidden behind extraction.

The teaser detector should be conservative. A reasonable first rule is to treat HTML or text under a short character threshold as loadable when the entry has a canonical URL and no meaningful `content_html_sanitized`. This avoids replacing real full-feed articles.

## Security And Privacy

Extraction must preserve Rill's privacy stance.

- Fetch only `http` and `https` canonical URLs.
- Reject localhost, private-network, and malformed URLs.
- Send no user cookies or Authorization headers.
- Use a short timeout and byte cap.
- Sanitize extracted HTML before storage.
- Keep remote image behavior unchanged: images stay hidden by default and only load through the authenticated image proxy.
- Store extraction errors as generic user-facing states, not raw remote page details.

## Storage

The first pass should reuse the existing `entries` fields:

- `content_html_sanitized` stores sanitized extracted HTML.
- `content_text` stores extracted plain text.
- `content_hash` changes when extraction adds content.
- `updated_at` changes so sync picks up the updated entry.
- `content_html_raw` should not store the full fetched page.

If a durable extraction status is needed for UI feedback, add a small nullable field in a follow-up migration only after the first implementation proves that transient client state is not enough. The first pass should avoid a migration unless tests expose a real need.

## Error Handling

Expected failures should be ordinary:

- The original URL returns a non-OK status.
- The page blocks Worker fetches.
- The page contains no readable article.
- The extraction package cannot parse the page.
- The page is too large or too slow.

All of these should return `{ ok: false, code, message }` with a concise message suitable for Reader. The client should keep showing the feed teaser and the original link.

## Test Plan

Worker tests:

- Extracts a readable fixture page and stores sanitized HTML plus plain text.
- Rejects entries not owned by the user.
- Rejects entries without a canonical URL.
- Rejects unsafe canonical URLs.
- Handles non-OK upstream responses without mutating the entry.
- Does not store raw fetched page HTML.

Client tests:

- Reader shows "Load full article" for a teaser entry with a canonical URL.
- Clicking the action calls the extraction API and refreshes the displayed entry.
- Reader shows a failure note while preserving the teaser and original link.
- Remote images from extracted HTML remain hidden until explicitly loaded.

Verification:

- `npm run typecheck`
- focused Vitest files for extraction and Reader
- `npm run build`
- `npm run lint:privacy`

## Rollback

Rollback is low cost if the first pass avoids a migration. Remove the extraction route, client action, helper module, and dependency additions. Entries that already received extracted sanitized content will still render as normal cached content, which is acceptable because it passed the same sanitizer.

## Premise Check

This plan assumes Mozilla Readability with a Worker-compatible DOM parser can ship inside the existing Worker bundle. If that assumption fails, the fallback is a local `htmlparser2` extractor with lower article quality but the same API, storage, privacy, and Reader behavior.
