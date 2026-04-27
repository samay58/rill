# Rill Notebook Design Handoff

This handoff supersedes the generic visual language in the first scaffold. The active design direction is **Notebook**. Build from these assets and tokens, not from a fresh interpretation.

Full product spec: `docs/specs/2026-04-27-rill-design.md`.

## Reference assets

Read each image carefully before building the corresponding surface. These are the visual spec.

| Surface | Asset |
|---|---|
| Today desktop | `docs/design/reference/notebook-today-desktop@2x.png` |
| Reader desktop | `docs/design/reference/notebook-reader-desktop@2x.png` |
| Sources desktop | `docs/design/reference/notebook-sources-desktop@2x.png` |
| Today mobile | `docs/design/reference/notebook-today-mobile@2x.png` |

## Exact visual tokens

### Color

```css
--color-ground:        #F7F5F0;
--color-sidebar:       #EEE9E0;
--color-border:        #D8D3C8;
--color-divider:       #E8E3DB;
--color-text-primary:  #252318;
--color-text-muted:    #8A8A7A;
--color-text-faint:    #B0AA9E;
--color-accent:        #3D5A38;
--color-accent-light:  #C4CFBE;
--color-accent-mid:    #5C7A55;
--color-highlight:     #F3EFE8;
--color-read-opacity:  0.5;
```

### Typography

Reading body:

```css
font-family: Georgia, 'Times New Roman', serif;
```

- entry titles in list: 16px / 23px line-height / weight 400
- reader h1: 30px / 40px / weight 400
- reader body paragraphs: 17px / 28px / weight 400
- blockquote: 16px italic / 26px

UI chrome:

```css
font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

Inter must be bundled from `/src/fonts/` if used. Do not link Google Fonts or any external font CDN. If the font files are not present yet, use the fallback stack until they are added.

- source names in list: 11px / weight 500
- timestamps: 11px / weight 400
- nav labels: 13px / weight 400 inactive, 500 active
- toolbar actions: 12px / weight 400 to 500
- section headers: 11px / weight 600 / uppercase / letter-spacing 0.08em
- button labels: 12px / weight 500

### Layout

- sidebar width: 220px
- entry-list max-width: 780px
- reader column max-width: 620px
- content horizontal padding: 56px desktop
- desktop artboard: 1440px reference
- mobile artboard: 390px reference
- radius: 4 to 6px for buttons and badges, never above 8px
- spacing rhythm: 4px base
- entry row padding: 16px vertical
- gap between source name and title: 4px
- day group top padding: 20px

## Screen anatomy

### Sidebar

- 220px wide, `--color-sidebar` background, 1px `--color-border` right border
- top wordmark: `rill`, Georgia 18px, `--color-text-primary`
- nav: Today with unread badge, Saved, Sources, Search
- nav text: 13px Inter, 8px/12px padding, 6px active radius
- active nav background: `--color-border`
- active icon fill: `--color-accent`
- bottom settings icon

### Today list

- content area scrolls
- header row: Today in Inter 22px / 600, date in Inter 13px / 400 muted, refresh icon on the right
- day labels: TODAY, YESTERDAY, 11px / 600 Inter uppercase
- Today label uses `--color-text-muted`; older groups use `--color-text-faint`
- entry rows have `--color-divider` bottom border, 16px top/bottom padding, and 6px left gutter
- unread indicator: 6px circle, `--color-accent` if unread, `--color-divider` if read
- read rows: opacity 0.5 on the whole row
- source name and timestamp align inline on the baseline
- source name: 11px / 500 muted
- timestamp: 11px / 400 faint
- saved marker: small filled star SVG in `--color-accent` after timestamp
- title: Georgia 16px / 400, `--color-text-primary`
- excerpt: Inter 13px / 400, `--color-text-muted`, 19px line-height
- footer: centered `25 more from the past week` between two divider lines

### Reader

- same sidebar
- top left back link: `< Today`, Inter 13px muted
- toolbar right: Save pill, Archive, Mark unread, separator, Open Original with arrow
- Save pill: `--color-accent-light` background, `--color-accent` text
- article column: centered 620px, 56px top padding
- byline: Inter 11px / 500 muted, `source · author · date`
- h1: Georgia 30px / 400, letter-spacing -0.02em
- body paragraphs: Georgia 17px / 400, 28px line-height, 22px paragraph gap
- blockquote: 4px left bar `--color-accent`, Georgia 16px italic, 26px line-height, text at 80% opacity
- hidden images banner: `--color-sidebar` background, 6px radius, image icon, `N remote images hidden`, and `Load for this entry` action in `--color-accent`

### Sources

- header: Sources in Inter 22px / 600
- right toolbar: Import OPML, Export ghost buttons with 1px `--color-border`; Add source with `--color-accent-light` background and `--color-accent` text
- rows use the same vertical lane structure as Today entries
- status dot: 6px circle, filled `--color-accent` for active, hollow for refreshing, `--color-divider` for archived
- source name: 14px / 500, `--color-text-primary`
- URL: 11px muted
- status line: `Updated Xh ago · N unread`, 11px `--color-text-faint`
- refreshing status text: `Refreshing...` in `--color-accent`
- refreshing row background: `--color-highlight`
- archived row: opacity 0.45, hollow dot, `archived` badge at 10px with 1px `--color-border` and 3px radius
- trailing actions: refresh icon and menu, 14px, `--color-text-faint`
- footer: `N active sources · Refresh all`, Inter 12px; Refresh all in `--color-accent`

### Mobile

- 390px reference width
- bottom tab bar replaces sidebar
- header: Today in Georgia 22px / 400
- `12 unread` inline in Inter 12px muted
- search and refresh icons on the right
- entry title: Georgia 14px / 21px
- excerpt: Inter 12px
- source and timestamp: 10px
- tab bar: `--color-sidebar` background, 1px `--color-border` top
- tab labels: Today, Saved, Sources, 10px / 600 Inter
- active tab color: `--color-accent`

## Rules to preserve in code

- No UI component library.
- No external font CDN calls.
- Georgia for all reading surfaces.
- System sans or bundled Inter for all chrome.
- Unread equals filled moss dot plus full opacity.
- Read equals faint dot plus 0.5 opacity on the entire row.
- Saved state is orthogonal to read state. A row can be read and saved.
- Image proxy remains mandatory. The browser must never directly fetch remote images.
- Offline app shell and cached entries must open without network.
- State mutations queue and replay.
- PWA installable, no push notifications in V1.

## Active vs back-pocket direction

Notebook is active. Quiet OS was explored as an alternative and should stay in reserve only if Notebook fails in implementation.
