# Rill

<p align="center">
  <img src="docs/assets/rill-github-repo-cover-page.png" alt="Rill cover: a quiet personal feed reader for chosen sources" width="100%">
</p>

Rill is a private, local-first feed reader for chosen RSS, Atom, and JSON Feed sources. It is built as a Vite React PWA plus a Cloudflare Worker API backed by D1 and Queues.

The product covenant is simple: chosen sources, finite sessions, no recommendations, no generated summaries, no analytics, no ad-tech surface.

## Canonical location

Use `~/Projects/active/rill` as the project root.

## Stack

- TypeScript
- Vite and React
- Cloudflare Workers, D1, Queues, and Cron Triggers
- IndexedDB via `idb`
- Vitest and Playwright
- Hand-rolled UI with system fonts and Georgia

## Setup

```bash
npm ci
```

Initialize the local Worker database and session secret from the checkout or worktree you are actually running. Each worktree has its own local Wrangler state, so repeat this after switching to `./.worktrees/...`.

```bash
TOKEN='replace-with-a-long-random-token' npm run setup:local
```

`setup:local` applies the D1 migration, creates `.dev.vars` with `SESSION_SECRET` when missing, and stores only the SHA-256 hash of the token in the local `users` table. Keep the raw token out of git.

The raw unlock token is posted once to `/api/auth/unlock`. After unlock, Rill uses a signed httpOnly session cookie.

## Development commands

```bash
npm run dev          # Frontend only
npm run worker:dev   # Worker plus built assets through Wrangler
npm run typecheck
npm test
npm run build
npm run lint:privacy
npm run verify
npm run test:e2e
```

For Worker testing, build first, then run Wrangler:

```bash
npm run build
npx wrangler dev
```

## Privacy stance

Rill should be boring from a network perspective.

- No analytics SDKs
- No third-party scripts
- No external font CSS
- No UI component library
- Remote article images are hidden by default
- Proxied article images must go through `/api/image?entry_id=&src=`
- CSP stays same-origin except for safe inline style needed by the MVP build
- The privacy lint scans built HTML, JS, CSS, JSON, manifest, and SVG files for common third-party script, font, and analytics patterns

## Non-goals for V1

- Generated summaries
- Recommendations, ranking, clustering, or smart resurfacing
- Push notifications
- Watched keywords
- Full-text extraction from article pages
- Social features
- Usage analytics
- External fonts
- Third-party scripts
- Fake thumbnails

## Spec coverage review

Primary spec: `docs/specs/2026-04-27-rill-design.md`.

Contributor guide: `CONTRIBUTING.md`.

| Spec area | Current implementation | Status |
| --- | --- | --- |
| Private token unlock and session cookie | `src/worker/auth.ts`, `src/worker/routes/auth.ts`, `src/client/views/UnlockView.tsx` | Implemented |
| Multi-user-ready schema | `migrations/0001_initial.sql` includes `user_id` on owned tables | Implemented |
| RSS, Atom, JSON Feed parsing | `src/shared/feed/parse.ts`, feed fixtures | Implemented |
| Feed autodiscovery | `src/shared/feed/discover.ts`, subscription route | Implemented |
| Conditional refresh, Cron, Queue fanout, dedupe | `src/worker/feedFetch.ts`, `src/worker/routes/refresh.ts` | Implemented |
| D1 persistence | `src/worker/db.ts`, migration | Implemented |
| IndexedDB stores and offline mutation queue | `src/client/db.ts`, `src/client/sync.ts`, `src/client/App.tsx` | Implemented |
| Today and Reader Notebook UI | `src/client/views/TodayView.tsx`, `src/client/views/ReaderView.tsx`, `src/client/styles.css` | Implemented |
| Read, save, archive, unread state | Worker state API, local queue, Reader actions | Implemented |
| Sources management | Live Sources UI, subscription patch/delete, refresh actions | Implemented |
| OPML import/export | Shared OPML helpers, Worker routes, Sources import/export controls | Implemented |
| Local search | `src/client/search.ts`, `/api/search`, `src/client/views/SearchView.tsx` | Implemented |
| PWA install and offline shell | `public/manifest.webmanifest`, `public/sw.js`, Playwright smoke | Implemented |
| Remote image privacy | Reader hides by default and loads through `/api/image` only | Implemented |
| No third-party scripts/fonts/analytics | Hand-rolled UI, privacy lint, Playwright network check | Implemented |

## Final manual gate

The automated suite verifies the implementation contract. The human ship gate is the UX checklist in `docs/qa/manual-acceptance.md`, run against `npx wrangler dev` with seeded local D1 data and at least one real feed.
