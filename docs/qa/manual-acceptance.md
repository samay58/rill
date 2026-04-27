# Rill Manual Acceptance

Run from the Rill repo root: `~/Projects/active/rill`.

## Commands

```bash
npm run verify
npm run test:e2e
npm run build
npx wrangler dev
```

If the browser still shows an old UI after a code change, stop Wrangler, rerun `npm run build`, start `npx wrangler dev` again, then hard-refresh the page once. Wrangler serves the built `dist/` assets; `localhost:8787` will not pick up client source edits until the app is rebuilt.

## Manual checks

1. Unlock with the private token and confirm the raw token is not sent again after the session cookie is set.
2. Subscribe to Opt Out Project with `https://www.optoutproject.net/feed/`.
3. Discover another site feed from a normal site URL.
4. Read Today and confirm the list is finite, calm, and sorted newest first.
5. Confirm Today previews are compact: no raw `<p>`, `href=`, `target=`, or long article-body dumps appear in the list. Each preview is plain text and visually capped at two lines.
6. Open Reader and confirm the entry is marked read.
7. Save an entry, confirm the Reader button changes to `Saved`, then open Saved and confirm the entry is there.
8. Mark that saved entry unread; saved state must remain separate from read state.
9. Search for a known source name such as `Om my Om`; results should prioritize that source and not unrelated aggregator items.
10. Refresh the browser and confirm Rill reopens without asking for the token again while the session is valid.
11. Archive an entry and confirm it disappears from Today.
12. Install or reopen the PWA, go offline, and confirm the app shell and cached entries still open.
13. Import OPML, export OPML, then import the export again without duplicates.
14. In DevTools Network, confirm no third-party scripts, external fonts, analytics, or direct remote article images load. Remote images must go through `/api/image` only.

## Notes

This checklist is the human UX gate. Run it against `npx wrangler dev` with seeded local D1 data and at least one real feed.
