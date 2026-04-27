# Rill Manual Acceptance

Run from the Rill repo root: `~/Projects/active/rill`.

## Commands

```bash
npm run verify
npm run test:e2e
npx wrangler dev
```

## Manual checks

1. Unlock with the private token and confirm the raw token is not sent again after the session cookie is set.
2. Subscribe to Opt Out Project with `https://www.optoutproject.net/feed/`.
3. Discover another site feed from a normal site URL.
4. Read Today and confirm the list is finite, calm, and sorted newest first.
5. Confirm Today previews are compact: no raw `<p>`, `href=`, `target=`, or long article-body dumps appear in the list. Each preview is plain text and visually capped at two lines.
6. Open Reader and confirm the entry is marked read.
7. Save an entry, then mark it unread; saved state must remain separate from read state.
8. Archive an entry and confirm it disappears from Today.
9. Install or reopen the PWA, go offline, and confirm the app shell and cached entries still open.
10. Import OPML, export OPML, then import the export again without duplicates.
11. In DevTools Network, confirm no third-party scripts, external fonts, analytics, or direct remote article images load. Remote images must go through `/api/image` only.

## Notes

This checklist is the human UX gate. Run it against `npx wrangler dev` with seeded local D1 data and at least one real feed.
