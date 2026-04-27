# Repository Guidelines

## Project Structure & Module Organization

Rill is a TypeScript local-first feed reader: a Vite React PWA plus a Cloudflare Worker API. Frontend code lives in `src/client/`, Worker API and queue/cron handling in `src/worker/`, and shared contracts/feed utilities in `src/shared/`. Database schema lives in `migrations/0001_initial.sql`; static PWA assets are in `public/`. Tests mirror product layers under `tests/client/`, `tests/worker/`, `tests/feed/`, `tests/db/`, and `tests/e2e/`. Specs, design references, and manual QA live in `docs/`.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from `package-lock.json`.
- `npm run dev`: run Vite on `127.0.0.1`.
- `npm run build`: build client assets.
- `npm run worker:dev`: run Wrangler with built assets and the Worker API.
- `npm run typecheck`: run strict `tsc --noEmit`.
- `npm test`: run Vitest once; use `npm test -- tests/path/file.test.ts` for focus.
- `npm run test:e2e`: run Playwright smoke tests.
- `npm run lint:privacy`: scan built output for forbidden third-party/privacy patterns.
- `npm run verify`: run typecheck, unit tests, build, and privacy lint.

For local Worker data, apply D1 migrations with `npx wrangler d1 migrations apply rill --local`.

## Coding Style & Naming Conventions

Use TypeScript ESM and React JSX. Keep files strict, typed, and dependency-light. Follow the existing two-space indentation, single quotes, semicolon style, and `PascalCase` React components. Use `camelCase` for functions/variables and domain names such as `entryState`, `subscription`, and `syncCursor`. Keep UI hand-rolled; do not add component libraries, external fonts, analytics SDKs, or third-party scripts.

## Testing Guidelines

Vitest is configured in `vite.config.ts` for `tests/**/*.test.ts(x)` with `jsdom` globals. Place tests near the relevant layer, named `*.test.ts` or `*.test.tsx`. Add or update tests for feed parsing, D1 routes, IndexedDB sync, and UI flows when touching those surfaces. Run `npm run verify` before committing; run `npm run test:e2e` for user-flow or PWA changes.

## Commit & Pull Request Guidelines

Recent history uses short Conventional Commit-style subjects, for example `feat: wire local-first app sync` and `docs: document rill mvp workflow`. Keep commits focused and imperative. PRs should include behavior changes, tests run, D1 migration or Wrangler notes, and screenshots for visible UI changes. Link the relevant issue or spec when available.

## Security & Configuration Tips

Keep `.dev.vars`, unlock tokens, session secrets, and D1 seed values out of git. Preserve the privacy stance in `README.md` and the design spec: same-origin CSP, sanitized feed HTML only, hidden remote images by default, and image loading only through `/api/image?entry_id=&src=`.
