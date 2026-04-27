---
type: "design-brief"
scope: "Rill Paper exploration"
status: "approved 2026-04-27"
owner: "samay"
related:
  - "docs/specs/2026-04-27-rill-design.md"
---

# Rill Paper Brief

Design Rill as a full product system, not a hero shot.

I want three distinct but aligned design directions for a calm personal feed reader called **Rill**.

## Product context

Rill is a private reader for chosen sources.

It is explicitly **not** a recommendation app, a social feed, a dashboard, a growth surface, or a summary wrapper around other people’s writing.

The product covenant:

- user chooses the sources
- sessions are finite
- no algorithmic manipulation
- no generated summaries or filler
- no ad-tech surface
- privacy defaults are strict
- original writing stays respected

The MVP product surfaces are:

1. **Today** - unread, unarchived entries from chosen feeds, reverse chronological, finite pages
2. **Reader** - calm reading view for feed-provided content with Save, Archive, Mark unread, Open Original
3. **Add Source** - paste a site URL or feed URL, with autodiscovery when needed
4. **Sources** - manage subscriptions, folders/order, refresh, import/export OPML
5. **Mobile states** - all key flows must feel first-class on phone, not merely compressed desktop

## Hard constraints

Please respect all of these:

- no emoji UI
- no gradients
- no external fonts
- no dashboard clutter
- no gamification
- no fake thumbnails
- no recommendation rail
- no engagement tricks
- no dense power-user RSS aesthetic
- no exaggerated “premium productivity” styling
- no dependence on article extraction visuals; V1 reads feed-provided content only
- remote images are hidden by default, so the design should work beautifully even when entries are mostly text

## Technical reality to design against

- installable PWA
- local-first feel with IndexedDB cache
- strict CSP, no third-party scripts
- remote images only through authenticated proxy when the user explicitly asks to load them
- system fonts only
- buildable by a small team without a design-system bureaucracy

## Required output from Paper

Give me **three complete design directions**:

1. **Notebook**
   - literary, typeset, warm, quiet
   - should feel like a reading notebook or annotated journal

2. **Field Instrument**
   - precise, logbook-like, technical, calm
   - should feel trustworthy, measured, and slightly toolish without becoming cold

3. **Quiet OS**
   - native-feeling, soft, minimal, highly usable
   - should feel like the feed reader Apple never made, but more personal

For each direction, I want a **full-flow product concept**, not just a moodboard.

## Screen and state coverage

For **each** direction, cover all of the following.

### Desktop

1. **Today**
   - default list state
   - caught-up state
   - empty/new-user state
   - loading state
   - offline/stale-data state

2. **Reader**
   - article open state
   - state with hidden remote images
   - state after user chooses to load images
   - actions for Save / Archive / Mark unread / Open Original

3. **Add Source**
   - add by direct feed URL
   - add by normal site URL with autodiscovery
   - multiple-feed chooser state
   - validation/error state

4. **Sources**
   - populated subscription list
   - refresh state
   - archived/inactive source state
   - OPML import/export affordance

### Mobile

Show how the product works on phone for:

- Today
- Reader
- Add Source
- Sources
- offline reopen / stale content messaging

The mobile work matters. Do not just provide a shrunk desktop frame.

## Deliverable format

For each direction, provide:

1. **One-paragraph design thesis**
   - what emotional posture this direction creates
   - why it fits Rill specifically

2. **Visual system**
   - color palette
   - typography using system fonts only
   - spacing rhythm
   - surface treatment
   - iconography approach
   - interaction tone

3. **Desktop key screens**
   - Today
   - Reader
   - Add Source
   - Sources

4. **Mobile key screens**
   - Today
   - Reader
   - Add Source
   - Sources

5. **Component behavior notes**
   - list row anatomy
   - reader header/footer actions
   - hidden-image placeholder treatment
   - search behavior placement
   - source status treatment
   - empty/loading/error/offline messaging style

6. **Buildability notes**
   - why this direction is practical to implement
   - what must be preserved if engineering simplifies it

## Design guidance by direction

### Direction 1: Notebook

Aim for:

- warmth
- literary calm
- excellent reading proportions
- sense of personal curation
- quiet tactility without skeuomorphism

Avoid:

- faux paper clichés
- sepia gimmicks
- overdesigned editorial flourishes
- “Substack but prettier” energy

### Direction 2: Field Instrument

Aim for:

- precision
- trust
- measured clarity
- operational calm
- restrained technical beauty

Avoid:

- terminal cosplay
- hacker green-on-black clichés
- data dashboarding
- excessive density

### Direction 3: Quiet OS

Aim for:

- native ease
- softness
- legibility
- mobile excellence
- obvious, low-friction interaction design

Avoid:

- generic startup SaaS UI
- blankness without personality
- glassmorphism spectacle
- ornamental minimalism that hurts reading

## Evaluation criteria

I will judge the directions on:

- **reading calm** - does it actually make me want to read here?
- **trust** - does it feel private, honest, and non-manipulative?
- **finite-session clarity** - does it help me enter and leave cleanly?
- **source ownership** - does it reinforce that I chose these sources?
- **mobile usefulness** - does it genuinely work on phone?
- **buildability** - can a small team implement it without faking half the experience?

## Important product truths to preserve

- Rill should feel better when the feed is mostly text.
- It should not depend on rich media to look complete.
- “Open Original” is always important.
- Settings exists, but it is not the star of the product.
- The design should make it obvious that remote images are optional, not missing by accident.
- The product should feel finite, not bottomless.

## Final ask

Please produce three clearly differentiated directions with enough fidelity that I can choose one and hand it to an implementation owner without another round of basic product invention.
