# Rill UI Polish Implementation Plan

> **For implementers:** Work through this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the Notebook UI without changing the product shape: remove dead controls, make saved/search/source states feel complete, and add focused interaction polish while preserving Rill's quiet visual language.

**Architecture:** Work in the isolated `ui-polish` branch/worktree. Keep changes small and reviewable: shared entry row behavior for Today/Saved, callback wiring for header controls, defensive preview text in every list surface, source refresh feedback, and CSS-only interaction/reader-content polish.

**Tech Stack:** React, TypeScript, CSS tokens, Vitest, existing Vite/Worker test stack. No component libraries, external fonts, analytics, gradients, or new visual systems.

---

## Review Baseline

- Worktree: `~/Projects/active/rill/.worktrees/ui-polish`
- Branch: `ui-polish`
- Baseline verification: `npm run verify` passed after rerunning outside the sandbox restrictions that blocked Vite temp-file writes.
- Design reference: Notebook handoff and four Paper exports in `docs/design/reference/`.

## Findings to Fix

1. **Dead header controls**: Today has Search and Refresh buttons with no action. This is a trust issue, not just polish.
2. **Saved nav dead-end**: Saved entries can exist, but the Saved route still says the surface comes later.
3. **Search preview regression risk**: Search results still render `summary_text` directly, so stale cached HTML can leak there even though Today is fixed.
4. **Source refresh lacks feedback**: Source refresh actions call the API but do not show refreshing state or refresh the local view afterward.
5. **Interaction states are under-specified**: Focus-visible, hover, disabled, and touch target states need a quiet but explicit pass.
6. **Reader rich content needs guardrails**: Feed-provided links, lists, headings, code, rules, and proxied images need Notebook-appropriate styling so Reader does not feel raw when feeds provide richer HTML.

## Non-goals

- No new visual direction beyond Notebook.
- No design-system rewrite.
- No external font bundle in this pass.
- No animations beyond subtle state transitions.
- No new backend behavior.

## Task 1: Wire Today Header Controls

**Files:**
- Modify: `src/client/views/TodayView.tsx`
- Modify: `src/client/App.tsx`
- Test: `tests/client/today-reader.test.tsx`

- [ ] Add failing tests that click Today Search and Refresh buttons and assert callbacks fire.
- [ ] Add optional `onSearch`, `onRefresh`, and `isRefreshing` props to `TodayView`.
- [ ] In `App`, route Search to `setRoute('search')` and run refresh via `refreshAllSubscriptions()` followed by `refreshFromServer()`.
- [ ] Keep buttons visually quiet; disable Refresh while a refresh is running.

## Task 2: Make Saved a Real Reading Surface

**Files:**
- Create: `src/client/views/SavedView.tsx`
- Modify: `src/client/App.tsx`
- Test: `tests/client/saved-view.test.tsx`

- [ ] Add failing tests proving Saved shows saved, unarchived entries sorted by saved time and opens Reader.
- [ ] Implement a simple Saved surface using existing row anatomy and Notebook list styling.
- [ ] Empty state copy: `No saved entries yet`.

## Task 3: Share Row Behavior and Cull Search Previews

**Files:**
- Create: `src/client/views/EntryListRow.tsx`
- Modify: `src/client/views/TodayView.tsx`
- Modify: `src/client/views/SavedView.tsx`
- Modify: `src/client/views/SearchView.tsx`
- Modify: `src/client/views/entryExcerpt.ts`
- Test: `tests/client/sources-search-image.test.tsx`

- [ ] Extract the common Notebook entry row so Today and Saved stay consistent.
- [ ] Change `entryExcerpt()` to type against `EntryWithState` directly.
- [ ] Use `entryExcerpt()` in Search results and cap search previews.
- [ ] Add a regression test that Search never shows raw `<p>` or `href=` from cached summaries.

## Task 4: Show Source Refresh Feedback

**Files:**
- Modify: `src/client/App.tsx`
- Modify: `src/client/views/SourcesView.tsx`
- Test: `tests/client/sources-search-image.test.tsx`

- [ ] Track `refreshingSubscriptionIds` and `isRefreshingAll` in `App`.
- [ ] Pass `isRefreshing` to source rows.
- [ ] Disable refresh controls while the relevant refresh is running.
- [ ] Refresh local cached state after the remote refresh completes.

## Task 5: CSS Polish Pass

**Files:**
- Modify: `src/client/styles.css`
- Modify: `src/client/views/TodayPreview.tsx`

- [ ] Add visible but quiet focus states for buttons, links, and inputs.
- [ ] Add subtle hover/active/disabled states where they clarify interaction.
- [ ] Ensure mobile icon buttons meet touch-target expectations.
- [ ] Style Reader links, lists, headings, code, rules, and proxied images with Notebook tokens.
- [ ] Keep TodayPreview excerpts on the same `.entry-excerpt` class used by production rows.

## Verification

Run, in order:

```bash
npm run verify
npm run test:e2e
python3 - <<'PY'
from pathlib import Path
markers = ['TO'+'DO', 'TB'+'D', 'XX'+'X', 'del'+'ve', 'Further'+'more', 'Addition'+'ally', 'More'+'over', 'best-'+'in-class', 'world-'+'class', 'cutting-'+'edge', 'lo'+'rem', 'mag'+'ical', 'seam'+'less']
for root in [Path('src'), Path('tests'), Path('docs/plans/2026-04-27-rill-ui-polish.md')]:
    files = [root] if root.is_file() else [p for p in root.rglob('*') if p.is_file()]
    for file in files:
        text = file.read_text(errors='ignore')
        for marker in markers:
            if marker in text:
                print(f'{file}: contains {marker}')
PY
rg -n "fonts\.googleapis|googletagmanager|google-analytics|segment|mixpanel|<script[^>]+https?://|<link[^>]+stylesheet[^>]+https?://" src tests public dist || true
git diff --check
git status --short --ignored
```

Expected: all automated tests pass, no privacy regressions, no whitespace errors, and only intentional branch changes appear.
