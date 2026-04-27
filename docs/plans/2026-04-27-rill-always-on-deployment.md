# Rill Always-On Deployment Implementation Plan

> **For implementers:** Work through this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Rill at a stable HTTPS URL so Samay opens the reader like a normal app instead of running `localhost` or keeping a terminal process alive.

**Architecture:** Rill should run as one deployed Cloudflare Worker with bundled static assets, a remote D1 database, a remote Queue consumer, and a Cron Trigger for scheduled feed refresh. Localhost remains only for development; production state lives in Cloudflare bindings and a custom domain or workers.dev URL.

**Tech Stack:** Cloudflare Workers, Wrangler, Workers Static Assets, D1, Queues, Cron Triggers, Rill's existing Vite build, single-token auth.

---

## What “Always On” Means

Rill does not need a VPS, a laptop terminal, or `npx wrangler dev` to stay open. After deployment:

- the app shell and Worker API are served from Cloudflare on HTTPS;
- browser requests wake the Worker on demand;
- D1 stores subscriptions, entries, sessions, and read/save/archive state remotely;
- the Queue and Cron Trigger refresh feeds remotely every 30 minutes;
- the PWA can be installed from the production URL and reopened without typing localhost.

`localhost:8787` stays the development lane. The daily lane should be either:

1. the exact `workers.dev` URL printed by Wrangler for the first stable deployment; or
2. `https://rill.samayz.ing` after the custom-domain choice is confirmed.

## Source Notes

- Cloudflare Workers `wrangler deploy` publishes Workers to Cloudflare. Source: <https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy>
- Workers Static Assets deploy Worker code and static assets as one unit from the configured assets directory. Source: <https://developers.cloudflare.com/workers/static-assets/>
- D1 `d1 create` returns the remote database UUID for `wrangler.toml`; `d1 migrations apply --remote` applies migrations to the remote database. Source: <https://developers.cloudflare.com/d1/wrangler-commands/>
- Queues require a remote queue plus producer/consumer bindings in Wrangler config. Source: <https://developers.cloudflare.com/queues/get-started/>
- Cron Triggers live in Wrangler config, run on UTC schedules, and can take up to 15 minutes to propagate. Source: <https://developers.cloudflare.com/workers/configuration/cron-triggers/>
- Production secrets should be set with `wrangler secret put`; local-only secrets belong in `.dev.vars` and must not be committed. Source: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Custom Domains point a hostname directly at the Worker and can be configured with `custom_domain = true`. Source: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>

## Scope

In scope:

- Remote Cloudflare resource setup.
- Explicit deploy and remote database commands.
- Stable URL strategy.
- Production seeding for the one-user alpha.
- Verification steps for production auth, feed refresh, PWA installability, privacy headers, and Cron.

Out of scope:

- Multi-user account management.
- A public landing page.
- Push notifications.
- GitHub Actions or CI/CD automation.
- Third-party monitoring, analytics, or error trackers.

## File Structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `wrangler.toml` | Modify | Replace the local D1 development ID with the real remote D1 UUID; optionally add a custom-domain route. |
| `package.json` | Modify | Add deploy and remote DB scripts that encode the intended production workflow. |
| `docs/deployment/always-on.md` | Create | Human runbook for first deploy, daily usage, remote operations, and recovery. |
| `docs/qa/manual-acceptance.md` | Modify | Add a production URL acceptance gate after local QA. |

## Task 1: Make Deployment Commands Explicit

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deployment scripts**

Change the `scripts` block to include these commands while preserving existing scripts:

```json
{
  "worker:dev": "wrangler dev",
  "deploy": "npm run verify && wrangler deploy",
  "db:migrate:remote": "wrangler d1 migrations apply rill --remote",
  "logs:remote": "wrangler tail"
}
```

- [ ] **Step 2: Verify scripts are valid**

Run:

```bash
npm run typecheck
npm run build
```

Expected: TypeScript and Vite build pass. Do not run `npm run deploy` until Tasks 2-4 are complete.

- [ ] **Step 3: Commit command surface**

```bash
git add package.json
git commit -m "chore: add rill deployment commands"
```

## Task 2: Provision Remote Cloudflare Bindings

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: Create the remote D1 database**

Run:

```bash
npx wrangler d1 create rill
```

Expected: Wrangler prints a `database_id` UUID and a D1 binding snippet.

- [ ] **Step 2: Replace the local D1 development ID**

In `wrangler.toml`, replace:

```toml
database_id = "local-rill-dev"
```

with the concrete UUID printed by `wrangler d1 create rill`. The UUID is not a secret. It belongs in git.

Verify the development ID is gone:

```bash
rg -n 'local-rill-dev' wrangler.toml
```

Expected: no matches.

- [ ] **Step 3: Create the remote Queue**

Run:

```bash
npx wrangler queues create rill-refresh
```

Expected: Wrangler creates the remote queue used by the existing `REFRESH_QUEUE` producer and consumer bindings.

- [ ] **Step 4: Verify the config parses**

Run:

```bash
npx wrangler deploy --dry-run
```

Expected: Wrangler accepts the Worker, assets binding, D1 binding, Queue binding, and Cron Trigger config without deploying.

- [ ] **Step 5: Commit Cloudflare binding update**

```bash
git add wrangler.toml
git commit -m "chore: bind rill to remote cloudflare resources"
```

## Task 3: Set Production Secrets and Seed the Alpha User

**Files:**
- No committed source changes.

- [ ] **Step 1: Set the production session secret**

Run:

```bash
npx wrangler secret put SESSION_SECRET
```

When Wrangler prompts for the value, paste a newly generated 48+ byte random secret from a password manager or `openssl rand -base64 48`. Expected: Wrangler stores the secret for the deployed Worker. Do not put `SESSION_SECRET` in `wrangler.toml`.

- [ ] **Step 2: Apply schema migrations to remote D1**

Run:

```bash
npm run db:migrate:remote
```

Expected: migration `0001_initial.sql` is applied to remote D1.

- [ ] **Step 3: Seed Samay's remote user without saving the raw token**

Run this from a shell where command history is acceptable for variable names but not raw secret values:

```bash
read -rs "RILL_TOKEN?Rill token: "
print
TOKEN_HASH=$(RILL_TOKEN="$RILL_TOKEN" node -e "const { createHash } = require('node:crypto'); console.log(createHash('sha256').update(process.env.RILL_TOKEN).digest('hex'))")
NOW_MS=$(node -e "console.log(Date.now())")
npx wrangler d1 execute rill --remote --command "INSERT OR REPLACE INTO users (id, handle, token_hash, created_at, updated_at) VALUES ('user-1', 'samay', '$TOKEN_HASH', $NOW_MS, $NOW_MS)"
unset RILL_TOKEN TOKEN_HASH NOW_MS
```

Expected: remote D1 has one user row for `samay`; the raw token never enters source control.

## Task 4: Deploy the Stable Workers URL

**Files:**
- No committed source changes unless Task 1 added scripts in the same branch.

- [ ] **Step 1: Deploy**

Run:

```bash
npm run deploy
```

Expected: Wrangler deploys Worker code and `dist/` assets to Cloudflare and prints a stable `workers.dev` URL for `rill`.

- [ ] **Step 2: Verify the production URL**

Open the printed HTTPS URL and verify:

- unlock succeeds with the private token;
- the session cookie persists across refreshes;
- adding `https://www.optoutproject.net/feed/` succeeds;
- Today shows entries from remote D1;
- Reader opens entries without direct remote image loads;
- DevTools Network shows no third-party scripts, analytics, or external font CDN calls.

- [ ] **Step 3: Verify remote scheduled refresh plumbing**

Run:

```bash
npx wrangler tail
```

Then, in another terminal, trigger a manual remote refresh from the app UI or POST `/api/refresh` after unlocking in the browser.

Expected: Worker logs show refresh work and no unhandled exceptions. Cron itself may take up to 15 minutes to propagate after deployment.

## Task 5: Attach the Permanent Custom Domain

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: Confirm the hostname**

Default recommendation: `rill.samayz.ing` because it is short, personal, and consistent with the existing Phoenix domain family. If Samay chooses a different hostname, use that instead and do not edit this task's intent.

- [ ] **Step 2: Add the custom domain route**

After hostname confirmation, add this to `wrangler.toml` with the chosen hostname:

```toml
[[routes]]
pattern = "rill.samayz.ing"
custom_domain = true
```

- [ ] **Step 3: Deploy the route**

Run:

```bash
npm run deploy
```

Expected: Wrangler deploys the Worker and Cloudflare creates the custom-domain route and certificate.

- [ ] **Step 4: Verify custom-domain behavior**

Open `https://rill.samayz.ing` and verify:

- unlock works;
- cookies are scoped to the production hostname;
- reloads do not send the user back to localhost;
- PWA install uses the custom-domain URL;
- `/api/bootstrap`, `/api/entries`, `/api/subscriptions`, `/api/refresh`, and `/api/opml/export` all return expected authenticated responses.

- [ ] **Step 5: Commit custom-domain config**

```bash
git add wrangler.toml
git commit -m "chore: attach rill custom domain"
```

## Task 6: Document Operations and Recovery

**Files:**
- Create: `docs/deployment/always-on.md`
- Modify: `docs/qa/manual-acceptance.md`

- [ ] **Step 1: Write `docs/deployment/always-on.md`**

Create a concise runbook with these sections:

```md
# Rill Always-On Runbook

## Daily URL

Use `https://rill.samayz.ing` once the custom domain is attached. Until then, use the `workers.dev` URL printed by `npm run deploy`. Do not use localhost except for development.

## Local development

Run `npm run worker:dev` from `~/Projects/active/rill` and use `.dev.vars` plus local D1. Local data is not production data.

## Deploy

Run `npm run deploy` from `~/Projects/active/rill` after `git status --short` is clean except intentional changes.

## Remote database

Apply migrations with `npm run db:migrate:remote`. Seed or rotate the private token with `npx wrangler d1 execute rill --remote` after hashing the token locally.

## Feed refresh

The deployed Worker has `*/30 * * * *` in `wrangler.toml`. Cron runs remotely on UTC. Use `npx wrangler tail` to inspect refresh logs.

## Recovery

If unlock stops working, check `SESSION_SECRET`, confirm the `users` row exists in remote D1, and clear the browser cookie before retrying. If feeds stop refreshing, run a manual refresh in the UI and watch `npx wrangler tail` for queue or fetch errors.
```

- [ ] **Step 2: Add a production QA gate**

Append this to `docs/qa/manual-acceptance.md`:

```md
## Production URL check

After deployment, run the manual checks against the stable HTTPS URL, not localhost. Confirm the PWA opens from that URL, remote D1 persists entries after browser refresh, and scheduled refresh is visible in Cloudflare logs or `npx wrangler tail`.
```

- [ ] **Step 3: Commit runbook**

```bash
git add docs/deployment/always-on.md docs/qa/manual-acceptance.md
git commit -m "docs: add rill always-on runbook"
```

## Definition of Done

- Rill has one stable HTTPS URL.
- `localhost` is only needed for development.
- Remote D1 stores the production reading state.
- Remote Queue and Cron refresh feeds without a local terminal running.
- `SESSION_SECRET` lives in Cloudflare secrets, not source control.
- The custom domain is attached or the `workers.dev` URL is explicitly accepted as the temporary daily URL.
- The manual acceptance checklist passes on the production URL.
- `npm run verify` and `npm run test:e2e` pass before every deploy.

## Risks and Guardrails

- The current `database_id = "local-rill-dev"` is only a local development ID. Do not deploy production until it is replaced with the real D1 UUID.
- Cron Trigger updates can take several minutes to propagate. Do not diagnose scheduled refresh as broken until the propagation window has passed.
- Do not add analytics, external fonts, error trackers, or third-party scripts while adding production observability.
- Do not store the raw private token in shell scripts, `.dev.vars`, docs, commits, screenshots, or issue text.
- If the custom domain is not ready, ship the `workers.dev` URL first. It is better to have one stable daily URL today than wait on DNS polish.
