# Recipe Detail Page Polish (Sub-project E) — Design

> **Status:** Approved design, ready for implementation planning.
> **Depends on:** Sub-project A (recipe tutorial schema, branch `feat/recipe-tutorial-schema`) must be merged and deployed first. This work starts on its own branch off `main` afterward.
> **Spec author date:** 2026-05-15

## Goal

Make the recipe detail page meaningfully prettier on **both web and mobile**, kept visually
consistent, by **restructuring the layout** into a two-column "mise en place" arrangement and
applying a **"Warm Cookbook" visual skin scoped to the recipe view only**. Presentation-only:
no schema, API, shared-package, or behavior changes. Legacy recipes (empty tutorial fields,
missing image) must render gracefully.

This is sub-project **E** from the tutorial-schema roadmap. A broader app-wide restyle is a
separate future sub-project (**E2**) and is explicitly out of scope here.

## Non-goals (carry forward; do not do in this sub-project)

- No app-wide restyle. App chrome (nav, buttons, other pages, cards on other screens) is
  untouched. (That is sub-project E2.)
- No schema / backend / `@cooking/shared` / `@cooking/api-client` changes. No new fields.
- No behavior changes: edit, delete, "add to meal planner", catalog/visibility actions,
  source-video link, and friend/catalog copy all work exactly as before.
- No new dependencies. Web stays plain CSS (no Tailwind). No webfont dependency — use a
  system serif stack for display type.
- No JS / scroll-driven / entrance animations. Only trivial CSS hover/transition of the
  kind already idiomatic in the app. (Rich motion is E2 territory.)
- No two-column layout on phones. A phone is always the single-column "collapsed" form.
- No backfill or data migration. No changes to image upload or `resolveImageUrl`.

## Architecture / approach

Presentation-only restructure of two existing view surfaces, sharing visual *intent* (the
same palette and hierarchy decisions) expressed per-platform with each platform's idioms.

### 1. Layout — "Mise en place" two-column (web)

`apps/web/app/recipe/[id]/page.tsx` — restructure the `.recipe-editorial` article JSX (no
data/logic change) into two regions:

- **Sticky left rail** (~36–38% width): meta block (⏱ total time, tags, source) +
  Ingredients + Equipment.
- **Main column**: hero → title → description → Steps → Tips.

Wide screens (`@media (min-width: 900px)`): `.recipe-editorial` becomes a CSS grid
(`grid-template-columns` rail + main). The rail is `position: sticky; top: <fixed-header
offset>` and `align-self: start` so it does not stretch to main-column height and sticks
correctly while the steps scroll. If rail content exceeds viewport height it scrolls with
the page first, then pins — acceptable; do not add an independent inner scroll.

Below 900px and on mobile: single column in this order — hero → title/description → meta →
Ingredients → Equipment → Steps → Tips (the refined current mobile order).

### 2. Hero image — full-width banner, title below

Top of the main column (web) / top of the screen (mobile): a rounded, soft-shadowed image
spanning the content width. Title + total-time chip + description sit **beneath** it (no
text overlay). When `thumbnail_url` is absent, render a warm gradient band of the same
dimensions instead of a broken/empty frame — never an empty box. Step images keep the
existing `resolveImageUrl` handling (mobile) and are sized consistently inside the warmer
step blocks.

### 3. Visual system — "Warm Cookbook" scoped accent layer

A warm skin **scoped to the recipe view container only** so the rest of the app stays
coherent:

- Cream/paper surface, ink-brown text, a single saffron/terracotta accent.
- Serif display for the recipe title and section headings (system serif stack, e.g.
  `Georgia, 'Times New Roman', serif` — no webfont).
- Soft rounded cards for the rail and step blocks; numbered step badges; tips rendered as
  an accent callout.
- **Web:** all new/changed rules live under the `.recipe-editorial` (recipe-view)
  scope in `apps/web/app/globals.css`, built from the existing CSS custom properties
  (extend with a small set of `--recipe-*` warm vars defined on the recipe container, not
  globally). Nothing outside the recipe view changes.
- **Mobile:** `apps/mobile/src/features/library/RecipeDetailScreen.tsx` restyled using
  existing `apps/mobile/src/theme/` tokens. If a warm surface/accent token is genuinely
  missing, add it to the theme module (`colors.ts` etc.) — never inline a hex. Other
  screens that don't import the new token are unaffected.

### Cross-platform consistency

Both platforms derive from the same palette/hierarchy decisions (same accent role, same
section order, same hero treatment, same step-badge concept), expressed in CSS variables
(web) and theme tokens (mobile). They should read as one product; pixel-identical is not
required.

## Components / units

- **Web recipe view** (`recipe/[id]/page.tsx`): JSX restructured into `rail` + `main`
  regions. Each existing section (meta, ingredients, equipment, steps, tips) keeps its
  current presence guard — empty subsections must not emit empty headers (preserve the
  sub-project A legacy-safety behavior).
- **Web styles** (`globals.css`): scoped `.recipe-editorial` grid + warm `--recipe-*`
  vars + restyled `.recipe-editorial*`, rail, hero, `.recipe-step*`, tips-callout rules.
- **Mobile recipe screen** (`RecipeDetailScreen.tsx`): section reorder/restyle, single
  column, warm token treatment, banner hero + no-image fallback.
- **Mobile theme** (`theme/*`): only-if-needed addition of warm tokens.

## Data flow

Unchanged. Same `Recipe` shape consumed by both views. No new fetches, no new state. Pure
render-layer change.

## Error / edge handling

- **No image:** warm gradient band placeholder (both platforms).
- **Legacy / empty fields:** every section stays presence-guarded; no empty headers,
  bullets, or chips. A recipe with none of the tutorial fields and no image must look
  intentional, not broken.
- **Very tall rail (web):** scrolls with page then sticks; no nested scrollbar.
- **Long titles / long step text:** must wrap cleanly in serif display without overflow;
  verify at narrow widths.
- **Narrow desktop window (just under breakpoint):** must fall to single column without a
  broken intermediate state.

## Testing / verification (repo has NO unit-test infra — per CLAUDE.md)

1. `npm --workspace @cooking/web run build` — green (catches type errors + `@types/react`
   drift before Vercel).
2. `cd apps/mobile && npx tsc --noEmit` — zero new errors.
3. `grep -rE "#[0-9a-fA-F]{6}" apps/mobile/src/{features,navigation,components}` — only the
   theme module may contain hex (zero matches outside it).
4. Manual click-through, both platforms:
   - Rich recipe (image + all tutorial sections) — two-column on wide web, single column
     mobile; warm skin reads well; hero prominent.
   - Legacy recipe (no tutorial fields, no image) — graceful; no empty sections; warm
     placeholder for image.
   - Web: wide viewport (rail sticky beside scrolling steps) vs narrow viewport (collapses
     cleanly) vs just-under-breakpoint.
   - No regression: edit, delete, add-to-planner, source-video link, catalog/friend copy
     still work and are visually consistent with unchanged app chrome.

## Risks

- **Sticky rail with variable content height (web)** — primary visual-QA focus; get
  `align-self: start` + sticky offset + tall-rail behavior right.
- **Cross-platform visual drift** — mitigated by shared palette/hierarchy intent.
- **Warm scope leaking into app chrome** — mitigated by scoping every new rule under the
  recipe-view container/screen and avoiding global token edits.
- **Serif system stack rendering differently across OSes** — acceptable; pick a robust
  stack and verify on macOS/iOS (primary targets).

## Sequencing

Ships **after** sub-project A is merged and deployed (backend-first order per CLAUDE.md is
A's concern; E is web+mobile presentation and carries no backend). E starts on a fresh
branch off `main`. Web ships via Vercel on merge; mobile ships on its own EAS cadence.

## Open follow-ups (out of scope, recorded)

- **E2 — app-wide restyle:** harmonize the rest of the app toward the warmer direction so
  the recipe view is no longer a scoped exception. Separate spec.
- Rich motion / polished interactions (sticky step progress, timers) — future, not E.
