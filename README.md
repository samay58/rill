# Rill

<p align="center">
  <img src="docs/assets/rill-github-repo-cover-page.png" alt="Rill cover: a quiet personal feed reader for chosen sources" width="100%">
</p>

<p align="center">
  <a href="docs/index.html">Open the plain-English cover page</a>
</p>

I built Rill because I wanted to read the web again.

Not the algorithmic web: the one that learns what keeps you anxious and gives you more of it. The actual web: the blogs, newsletters, and small publications that people write because they have something to say. The kind of writing that used to flow through RSS readers before RSS became unfashionable and everyone migrated somewhere worse.

The Opt Out Project starts from a blunt premise: yes, you can live without Big Tech. If data is the new oil, the goal is to help you go electric. Rill is a small version of that. It is a feed reader that works the way feed readers used to, before “feed reader” meant something that also recommends, summarizes, and tracks.

## What Rill does

Rill reads RSS, Atom, and JSON Feed sources. It shows you what those sources published, in order, without additions. You read what you want. You close it when you are done. The session is finite by design.

- **Today.** Entries published since you last opened Rill. There is a bottom.
- **Reader.** One article, clean. Mark it read, save it, archive it, come back later.
- **Sources.** Manage your subscriptions. OPML import and export so your feed list is yours to keep.
- **Search.** Local full-text search. Nothing shipped to a server.

## How it is built

Rill is a Progressive Web App backed by a Cloudflare Worker. Reading state lives in IndexedDB on your device. The Worker handles feed fetching and sync, not your reading habits.

- **TypeScript:** the whole thing.
- **Vite + React:** PWA with full offline shell.
- **Cloudflare Workers:** the API, running at the edge.
- **D1:** SQLite for server-side feed and entry state.
- **Queues + Cron Triggers:** feed refresh on a schedule, with conditional HTTP, fanout, and deduplication.
- **IndexedDB via `idb`:** client store and offline mutation queue.
- **Vitest + Playwright:** automated tests, including a network check that fails if any third-party scripts load.
- **Hand-rolled UI:** system fonts, Georgia for the reader, nothing imported that phones home.

Privacy is enforced structurally, not just by convention. A lint pass scans the compiled output at build time. Remote images are hidden by default and load only through a server-side proxy. The CSP is same-origin. Rill should be invisible from a network traffic perspective.

## Getting started

```bash
npm ci
TOKEN='replace-with-a-long-random-token' npm run setup:local
```

`setup:local` runs the D1 migration, writes `.dev.vars` with `SESSION_SECRET` when missing, and stores only the SHA-256 hash of the token in the local `users` table. Keep the raw token out of git.

Post the raw token once to `/api/auth/unlock`. After that, Rill sets a signed httpOnly session cookie and stays unlocked.

## Development commands

```bash
npm run dev          # Frontend only
npm run worker:dev   # Worker + built assets through Wrangler
npm run typecheck
npm test
npm run build
npm run lint:privacy
npm run verify
npm run test:e2e
```

Worker testing: build first, then run Wrangler directly.

```bash
npm run build
npx wrangler dev
```

## What it will not do

The non-goals are part of the design:

- No generated summaries.
- No recommendations, ranking, clustering, or smart resurfacing.
- No push notifications.
- No watched keywords.
- No full-text extraction from article pages.
- No social features.
- No usage analytics.
- No external fonts or third-party scripts.
- No fake thumbnails.
