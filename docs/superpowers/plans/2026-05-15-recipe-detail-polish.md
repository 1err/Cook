# Recipe Detail Page Polish (Sub-project E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. If executing in isolation, create a worktree via superpowers:using-git-worktrees first.

**Goal:** Restructure the recipe detail page (web + mobile) into a two-column "mise en place" layout with a full-width banner hero, skinned with a "Warm Cookbook" visual layer scoped to the recipe view only. Presentation-only — no schema, API, behavior, or dependency changes; legacy/empty recipes render gracefully.

**Architecture:** Web (`recipe/[id]/page.tsx` + scoped `.recipe-editorial` rules in `globals.css`): JSX regrouped into a full-width header (hero + title) over a CSS-grid body (sticky rail = meta/ingredients/equipment | main = steps/tips), collapsing to single column under 900px. Mobile (`RecipeDetailScreen.tsx` + `theme/`): same section order/hero/skin expressed with theme tokens, always single column. The warm skin is defined once as scoped CSS custom properties on the web recipe container and as theme tokens on mobile; app chrome is untouched.

**Tech Stack:** Next.js 14 App Router (web, plain CSS — no Tailwind); Expo SDK 54 / React Native 0.81 (mobile, theme-token design system); `@cooking/shared` types (unchanged).

**Spec:** `docs/superpowers/specs/2026-05-15-recipe-detail-polish-design.md`

**Repo testing reality:** No unit-test infra (no jest/pytest/vitest), per CLAUDE.md. Verification per task is: web `npm --workspace @cooking/web run build`, mobile `npx tsc --noEmit`, the mobile hardcoded-hex grep, and a manual visual checklist. Every task ends with concrete verify commands instead of `pytest`.

**Sequencing:** This ships AFTER sub-project A (`feat/recipe-tutorial-schema`) is merged + deployed. Start this on a fresh branch off `main`: `git switch main && git pull && git switch -c feat/recipe-detail-polish`. (If A is not yet merged when execution begins, branch off `feat/recipe-tutorial-schema` instead and note it — the spec doc already lives there.)

---

## Phase 1 — Web

### Task 1: Regroup `recipe/[id]/page.tsx` JSX into header + two-column body

No styling yet — only restructure the DOM into the regions the CSS will target. All data
loading, handlers (`handleDelete`), guards, `useMemo`, i18n calls, and conditional
presence checks must be preserved **verbatim**. Only the JSX tree between `return (` and
its closing `)` in `RecipeDetailContent` changes.

**Files:**
- Modify: `apps/web/app/recipe/[id]/page.tsx` (the `return (...)` block of `RecipeDetailContent`, currently lines 94–294)

- [ ] **Step 1: Replace the returned JSX tree**

Replace the entire `return ( <article className="recipe-editorial"> ... </article> );`
(lines 94–294) with this. Every expression (`tags.map`, `blurb`, `recipe.description`,
guards, handlers) is identical to the current code — only wrapper elements and grouping
changed:

```tsx
  return (
    <article className="recipe-editorial">
      <div className="recipe-editorial__topbar">
        <Link href="/library" className="font-headline recipe-detail-back">
          ← {t("nav.library")}
        </Link>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href={`/library/${id}`} className="btn-primary" style={{ padding: "0.55rem 1.15rem", minHeight: 44, fontSize: "0.9rem" }}>
            {t("common.edit")}
          </Link>
          <button
            type="button"
            className="font-headline recipe-editorial__ghostbtn"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? t("recipe.deleting") : t("common.delete")}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: "#c62828", marginTop: "0.5rem", fontSize: "var(--font-body)" }}>{error}</p>
      )}

      <div className="recipe-editorial__hero-img">
        {recipe.thumbnail_url ? (
          <img src={recipe.thumbnail_url} alt="" />
        ) : (
          <div className="recipe-editorial__hero-fallback" />
        )}
      </div>

      <header className="recipe-editorial__header">
        <div className="recipe-editorial__pills">
          {tags.map((tag) => (
            <span key={tag} className="recipe-editorial__pill recipe-editorial__pill--tertiary font-headline">
              {CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}
            </span>
          ))}
        </div>
        <h1 className="recipe-editorial__title font-headline">
          {lead}
          {accent ? (
            <>
              {" "}
              <span className="recipe-editorial__accent">{accent}</span>
            </>
          ) : null}
        </h1>
        {blurb && <p className="recipe-editorial__blurb">{blurb}</p>}
        {recipe.description && <p className="recipe-description">{recipe.description}</p>}
      </header>

      <div className="recipe-editorial__body">
        <aside className="recipe-rail">
          <div className="recipe-rail__meta">
            {typeof recipe.total_time_minutes === "number" && (
              <div className="recipe-total-time-chip">
                <span>⏱</span>
                <span>{recipe.total_time_minutes} {t("recipe.totalTime.minutesSuffix")}</span>
              </div>
            )}
            <div className="recipe-rail__metarow">
              <span className="recipe-rail__metalabel font-headline">{t("recipe.tags")}</span>
              <span className="recipe-rail__metaval">{tags.length ? tags.slice(0, 2).map((tag) => CATEGORY_LABELS[tag]).join(", ") : t("recipe.recipe")}</span>
            </div>
            <div className="recipe-rail__metarow">
              <span className="recipe-rail__metalabel font-headline">{t("common.ingredients")}</span>
              <span className="recipe-rail__metaval">{ingredientRows.length}</span>
            </div>
            <div className="recipe-rail__metarow">
              <span className="recipe-rail__metalabel font-headline">{t("common.source")}</span>
              <span className="recipe-rail__metaval">{recipe.source_url ? t("common.imported") : t("common.library")}</span>
            </div>
          </div>

          <div className="recipe-editorial-ingredients">
            <h2 className="font-headline">{t("common.ingredients")}</h2>
            {ingredientRows.length === 0 ? (
              <p style={{ color: "var(--muted)", textAlign: "center" }}>{t("recipe.noIngredients")}</p>
            ) : (
              ingredientRows.map((ing, idx) => (
                <div key={idx} className="recipe-editorial-ing-row">
                  <p className="recipe-editorial-ing-name font-headline">{ing.name?.trim()}</p>
                  <p className="recipe-editorial-ing-qty">{formatIngredientQuantity(ing) || "—"}</p>
                </div>
              ))
            )}
          </div>

          {(recipe.equipment ?? []).length > 0 && (
            <section className="recipe-equipment">
              <h3>{t("recipe.equipment")}</h3>
              <ul>{recipe.equipment!.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </section>
          )}
        </aside>

        <div className="recipe-main">
          {(recipe.steps ?? []).length > 0 && (
            <section className="recipe-steps">
              <h3>{t("recipe.steps")}</h3>
              <ol>
                {recipe.steps!.map((s, i) => (
                  <li key={i} className="recipe-step">
                    <div className="recipe-step__header">
                      <span className="recipe-step__index">{i + 1}</span>
                      {s.duration_seconds && s.duration_seconds > 0 && (
                        <span className="recipe-step__chip">⏱ {formatStepDuration(s.duration_seconds)}</span>
                      )}
                    </div>
                    <p className="recipe-step__text">{s.text}</p>
                    {s.image_url && <img src={s.image_url} alt="" className="recipe-step__image" />}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(recipe.tips ?? []).length > 0 && (
            <section className="recipe-tips">
              <h3>{t("recipe.tips")}</h3>
              <ul>{recipe.tips!.map((tp, i) => <li key={i}>{tp}</li>)}</ul>
            </section>
          )}

          {(recipe.steps ?? []).length === 0 && (recipe.tips ?? []).length === 0 && (
            <p className="recipe-main__empty" style={{ color: "var(--muted)" }}>{t("recipe.recipe")}</p>
          )}
        </div>
      </div>

      <div className="recipe-editorial__footer">
        <Link href={`/library/${id}`} className="btn-primary" style={{ textDecoration: "none", display: "inline-flex" }}>
          {t("recipe.editRecipe")}
        </Link>
        <Link href={`/planner`} className="font-headline recipe-editorial__ghostbtn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          {t("recipe.mealPlanner")}
        </Link>
      </div>

      {recipe.source_url && (
        <p style={{ margin: "2.5rem 0 0", textAlign: "center", fontSize: "0.9rem" }}>
          <a href={recipe.source_url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>
            {t("recipe.originalVideo")} →
          </a>
        </p>
      )}
    </article>
  );
```

Notes for the implementer:
- The old `.recipe-editorial__center` `__stats` grid and inline `blurb`/delete-button/
  ghost-link styles are intentionally replaced by classes (`recipe-editorial__blurb`,
  `recipe-rail__meta*`, `recipe-editorial__ghostbtn`) styled in Task 2 — do not re-add
  inline styles for them.
- The `recipe-main__empty` line keeps the page from showing an empty right column for a
  legacy recipe that has neither steps nor tips.
- Do not touch imports, `splitTitleAccent`, the load `useEffect`, `handleDelete`,
  `blurb` `useMemo`, the loading/error/`!recipe` early returns, or the default export.

- [ ] **Step 2: Verify the web build compiles**

Run: `npm --workspace @cooking/web run build`
Expected: build succeeds (the page is unstyled/rough but type-correct and renders).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/recipe/[id]/page.tsx
git commit -m "refactor(web): regroup recipe detail into header + two-column body"
```

---

### Task 2: Warm Cookbook skin + two-column grid + sticky rail (web CSS)

All new/changed rules are scoped under `.recipe-editorial` so nothing outside the recipe
view is affected. Warm palette is defined once as `--recipe-*` custom properties on the
container (literal colors are allowed in web CSS — the no-hex rule is mobile-only).

**Files:**
- Modify: `apps/web/app/globals.css` (the recipe block at lines 3991–4126, and the recipe single-liners at lines 4413–4422)

- [ ] **Step 1: Replace the `.recipe-editorial*` block (lines 3991–4126) with the new scoped skin + layout**

Replace everything from `.recipe-editorial {` (line 3991) up to and including the
`.recipe-editorial-ing-qty { ... }` rule that ends at line 4126 with:

```css
.recipe-editorial {
  /* Warm Cookbook tokens — scoped to the recipe view only */
  --recipe-paper: #f6efe1;
  --recipe-card: #fffaf0;
  --recipe-ink: #3a3026;
  --recipe-ink-soft: #6f6149;
  --recipe-accent: #b07a32;
  --recipe-accent-soft: #efe2c6;
  --recipe-line: #e3d6bb;
  --recipe-serif: ui-serif, Georgia, "Times New Roman", serif;
  --recipe-card-shadow: 0 2px 10px rgba(120, 90, 40, 0.12);

  max-width: 80rem;
  margin: 0 auto;
  padding: var(--space-24) var(--space-24) calc(var(--space-32) + 4rem);
  background: var(--recipe-paper);
  border-radius: 1.25rem;
  color: var(--recipe-ink);
}

.recipe-editorial__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

.recipe-editorial__ghostbtn {
  padding: 0.55rem 1.15rem;
  min-height: 44px;
  font-size: 0.9rem;
  font-weight: 700;
  border: 1px solid var(--recipe-line);
  border-radius: var(--radius-lg);
  background: var(--recipe-card);
  color: var(--recipe-ink-soft);
  cursor: pointer;
}

.recipe-editorial__hero-img {
  width: 100%;
  aspect-ratio: 21 / 9;
  border-radius: 1rem;
  overflow: hidden;
  box-shadow: var(--recipe-card-shadow);
  margin-bottom: 2rem;
}

.recipe-editorial__hero-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recipe-editorial__hero-fallback {
  width: 100%;
  height: 100%;
  min-height: 12rem;
  background: linear-gradient(135deg, var(--recipe-accent-soft), var(--recipe-accent));
}

.recipe-editorial__header {
  max-width: 52rem;
  margin: 0 auto 2.5rem;
  text-align: center;
}

.recipe-editorial__pills {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem;
  margin-bottom: 1.25rem;
}

.recipe-editorial__pill {
  padding: 0.35rem 1rem;
  border-radius: 9999px;
  font-size: 0.6875rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.recipe-editorial__pill--tertiary {
  background: var(--recipe-accent-soft);
  color: var(--recipe-accent);
}

.recipe-editorial__pill--primary {
  background: var(--recipe-accent-soft);
  color: var(--recipe-accent);
}

.recipe-editorial__title {
  margin: 0 0 1rem;
  font-family: var(--recipe-serif);
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--recipe-ink);
}

.recipe-editorial__accent {
  color: var(--recipe-accent);
  font-family: var(--recipe-serif);
  font-style: italic;
  font-weight: 700;
}

.recipe-editorial__blurb {
  margin: 0 0 1rem;
  font-size: 1.15rem;
  color: var(--recipe-ink-soft);
  line-height: 1.55;
}

.recipe-editorial__body {
  display: block;
}

.recipe-rail__meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.1rem 1.25rem;
  background: var(--recipe-card);
  border: 1px solid var(--recipe-line);
  border-radius: 1rem;
  box-shadow: var(--recipe-card-shadow);
  margin-bottom: 1.5rem;
}

.recipe-rail__metarow {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.recipe-rail__metalabel {
  font-size: 0.625rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--recipe-ink-soft);
}

.recipe-rail__metaval {
  font-size: 1rem;
  font-weight: 800;
  color: var(--recipe-ink);
}

.recipe-editorial-ingredients {
  margin: 0 0 1.5rem;
  padding: 1.25rem;
  background: var(--recipe-card);
  border: 1px solid var(--recipe-line);
  border-radius: 1rem;
  box-shadow: var(--recipe-card-shadow);
}

.recipe-editorial-ingredients h2 {
  margin: 0 0 1rem;
  font-family: var(--recipe-serif);
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--recipe-ink);
}

.recipe-editorial-ing-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--recipe-line);
}

.recipe-editorial-ing-row:last-child {
  border-bottom: none;
}

.recipe-editorial-ing-row:hover .recipe-editorial-ing-name {
  color: var(--recipe-accent);
}

.recipe-editorial-ing-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--recipe-ink);
  transition: color 0.15s ease;
}

.recipe-editorial-ing-qty {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--recipe-ink-soft);
  text-align: right;
  max-width: 45%;
}

@media (min-width: 900px) {
  .recipe-editorial__body {
    display: grid;
    grid-template-columns: minmax(16rem, 0.62fr) 1fr;
    gap: 2.5rem;
    align-items: start;
  }
  .recipe-rail {
    position: sticky;
    top: 1.5rem;
    align-self: start;
  }
}
```

- [ ] **Step 2: Replace the recipe single-liner rules (current lines 4413–4422)**

These currently contain hardcoded non-warm colors. Find this block:

```css
.recipe-description { font-style: italic; opacity:.85; margin: .5rem 0 1rem; }
.recipe-total-time-chip { display:inline-flex; gap:.3rem; align-items:center; background:#eef; padding:.2rem .55rem; border-radius:999px; font-size:.85rem; margin-bottom:.8rem; }
.recipe-step { display:flex; flex-direction:column; gap:.3rem; margin-bottom:1rem; }
.recipe-step__header { display:flex; align-items:center; gap:.5rem; font-weight:600; }
.recipe-step__index { background:#333; color:#fff; border-radius:999px; padding:.05rem .5rem; font-size:.8rem; }
.recipe-step__chip { background:#fef3c7; color:#92400e; border-radius:999px; padding:.05rem .5rem; font-size:.75rem; }
.recipe-step__text { margin: .2rem 0; }
.recipe-step__image { max-width: 100%; max-height: 320px; border-radius:10px; }
.recipe-equipment ul, .recipe-tips ul { padding-left:1.3rem; }
.recipe-steps ol { padding-left: 0; list-style: none; }
```

Replace it verbatim with:

```css
.recipe-description { font-family: var(--recipe-serif); font-style: italic; color: var(--recipe-ink-soft); margin: .25rem 0 1rem; }
.recipe-total-time-chip { display:inline-flex; gap:.35rem; align-items:center; background:var(--recipe-accent-soft); color:var(--recipe-accent); padding:.3rem .7rem; border-radius:999px; font-size:.85rem; font-weight:700; }
.recipe-main { display:flex; flex-direction:column; gap:1.5rem; }
.recipe-main__empty { text-align:center; padding:2rem 0; }
.recipe-steps, .recipe-equipment, .recipe-tips { background:var(--recipe-card); border:1px solid var(--recipe-line); border-radius:1rem; box-shadow:var(--recipe-card-shadow); padding:1.5rem; }
.recipe-steps h3, .recipe-equipment h3, .recipe-tips h3 { margin:0 0 1rem; font-family:var(--recipe-serif); font-size:1.4rem; font-weight:800; color:var(--recipe-ink); }
.recipe-step { display:flex; flex-direction:column; gap:.4rem; margin-bottom:1.5rem; }
.recipe-step:last-child { margin-bottom:0; }
.recipe-step__header { display:flex; align-items:center; gap:.6rem; font-weight:600; }
.recipe-step__index { display:inline-flex; align-items:center; justify-content:center; min-width:1.7rem; height:1.7rem; background:var(--recipe-accent); color:#fff; border-radius:999px; font-size:.9rem; font-weight:800; }
.recipe-step__chip { background:var(--recipe-accent-soft); color:var(--recipe-accent); border-radius:999px; padding:.15rem .6rem; font-size:.75rem; font-weight:700; }
.recipe-step__text { margin:.1rem 0; color:var(--recipe-ink); line-height:1.6; }
.recipe-step__image { max-width:100%; max-height:340px; border-radius:12px; margin-top:.3rem; }
.recipe-equipment ul, .recipe-tips ul { padding-left:1.2rem; margin:0; color:var(--recipe-ink); }
.recipe-equipment li, .recipe-tips li { margin:.35rem 0; }
.recipe-tips { background:#fdf5e3; border-left:4px solid var(--recipe-accent); }
.recipe-steps ol { padding-left:0; margin:0; list-style:none; }
.recipe-editorial__footer { display:flex; flex-wrap:wrap; gap:.75rem; justify-content:center; margin-top:2.5rem; }
```

- [ ] **Step 3: Verify the web build compiles**

Run: `npm --workspace @cooking/web run build`
Expected: build succeeds, no CSS/type errors.

- [ ] **Step 4: Manual visual check (dev server)**

Run: `npm run web:dev`, open `http://localhost:3000/recipe/<some-recipe-id>` (log in
first; use any recipe in your library). Confirm:
- Wide window (>900px): warm paper page, full-width banner hero, serif title centered
  below it, then a left rail (meta card + ingredients card + equipment) that **stays put
  while you scroll the steps** on the right, steps as cards with round accent number
  badges, tips as a left-accent callout.
- Narrow window (<900px): single column in order hero → title/description → meta →
  ingredients → equipment → steps → tips. No broken intermediate state at ~899px.
- A recipe with no image → warm gradient band, not an empty/broken frame.
- A legacy recipe with no steps/tips/equipment → no empty section cards, no empty right
  column (the `recipe-main__empty` line shows instead).
- The nav bar / buttons elsewhere are visually unchanged (open `/library` to confirm app
  chrome is untouched).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): warm cookbook skin + two-column sticky-rail recipe layout"
```

---

## Phase 2 — Mobile

### Task 3: Add the warm theme tokens the recipe screen needs

Mobile's palette is already warm (terracotta primary, warm neutrals). The skin needs a
slightly stronger "paper/card" separation, an accent-soft for chips, a tips-callout
background, and a serif title preset. Add them to the theme module so no hex is inlined
in feature code (CLAUDE.md rule).

**Files:**
- Modify: `apps/mobile/src/theme/colors.ts`
- Modify: `apps/mobile/src/theme/typography.ts`

- [ ] **Step 1: Add warm tokens to `colors.ts`**

In `apps/mobile/src/theme/colors.ts`, add these keys inside the `colors` object (place
them after the `surfaceContainerHigh`/`white` group, before `onSurface`):

```ts
  recipePaper: "#f6efe1",
  recipeCard: "#fffaf0",
  recipeLine: "#e3d6bb",
  accentSoft: "#efe2c6",
  accent: "#b07a32",
  tipsCallout: "#fdf5e3",
```

(Do not remove or rename existing tokens. `ColorToken` picks these up automatically.)

- [ ] **Step 2: Add a serif title preset to `typography.ts`**

`apps/mobile/src/theme/typography.ts` defines one `typography` object literal
(`satisfies Record<string, TextStyle>`); presets cannot spread each other inside it, so
copy `title1`'s literal values. Add this entry inside the `typography` object (e.g. right
after the `title1` line):

```ts
  recipeTitle: { fontSize: 28, fontWeight: "700", letterSpacing: 0.36, fontFamily: "Georgia" },
```

`fontFamily` is a valid `TextStyle` field so the `satisfies` constraint still holds.
`Georgia` is built-in on iOS — an acceptable system serif, no font dependency.

- [ ] **Step 3: Verify mobile types**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/theme/colors.ts apps/mobile/src/theme/typography.ts
git commit -m "feat(mobile): warm recipe theme tokens + serif title preset"
```

---

### Task 4: Restyle `RecipeDetailScreen.tsx` with the warm skin

Single column (a phone is always the collapsed layout). Same section order as today
(hero → title/desc → meta → ingredients → equipment → steps → tips — already correct).
Apply the warm card/badge/callout treatment via the Task 3 tokens. All presence guards
and `resolveImageUrl`/`formatStepDuration` usage stay verbatim.

**Files:**
- Modify: `apps/mobile/src/features/library/RecipeDetailScreen.tsx` (the `styles` object at lines 304–360; small JSX class/wrapper tweaks in 194–301)

- [ ] **Step 1: Replace the `styles` StyleSheet (lines 304–360) with the warm version**

Replace the entire `const styles = StyleSheet.create({ ... });` block with:

```tsx
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.recipePaper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.recipePaper },
  content: { paddingBottom: spacing["3xl"] },
  hero: { width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.accentSoft, borderBottomLeftRadius: radii.lg, borderBottomRightRadius: radii.lg },
  heroPlaceholder: { alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.recipeTitle, color: colors.onSurface, textAlign: "center" },
  metaCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.recipeCard,
    borderColor: colors.recipeLine,
    borderWidth: 1,
    borderRadius: radii.lg,
    gap: spacing.sm,
  },
  metaRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md },
  metaLabel: { ...typography.caption, color: colors.onSurfaceVariant, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  metaVal: { ...typography.body, color: colors.onSurface, fontWeight: "700" },
  totalTimeChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    backgroundColor: colors.accentSoft,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
  },
  totalTimeText: { ...typography.footnote, color: colors.accent, fontWeight: "700" },
  card: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.recipeCard,
    borderColor: colors.recipeLine,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  tipsCard: { borderLeftWidth: 4, borderLeftColor: colors.accent, backgroundColor: colors.tipsCallout },
  sectionTitle: { ...typography.title3, color: colors.onSurface, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.onSurfaceVariant, fontStyle: "italic", marginTop: spacing.md, textAlign: "center" },
  step: { marginTop: spacing.md },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepIndex: {
    ...typography.footnote,
    minWidth: 26,
    height: 26,
    lineHeight: 26,
    textAlign: "center",
    color: colors.white,
    backgroundColor: colors.accent,
    borderRadius: radii.full,
    fontWeight: "800",
    overflow: "hidden",
  },
  stepChip: {
    ...typography.caption,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  stepText: { ...typography.body, color: colors.onSurface, marginTop: spacing.xs },
  stepImage: { width: "100%", height: 220, borderRadius: radii.md, marginTop: spacing.sm },
  list: { gap: spacing.sm },
  ingredient: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.xs },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 9, marginRight: spacing.md },
  ingredientText: { flex: 1 },
  ingredientName: { ...typography.body, color: colors.onSurface },
  ingredientQty: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  bulletText: { ...typography.body, color: colors.onSurface, flex: 1 },
  subtle: { ...typography.subhead, color: colors.onSurfaceVariant },
  error: { ...typography.body, color: colors.error },
});
```

(`radii.lg` = 16 already exists in `apps/mobile/src/theme/radii.ts`; `radii.full`,
`radii.md`, `radii.sm` also exist — all used above are valid.)

- [ ] **Step 2: Update the JSX to use the new structure (lines 194–301)**

Apply these targeted edits to the returned JSX (keep all guards/logic verbatim):

1. Replace the meta-pill + description/total-time region. The current block is:

```tsx
        <Text style={styles.title}>{recipe.title}</Text>
        <Text style={styles.metaPill}>
          {recipe.ingredients.length} {recipe.ingredients.length === 1 ? "ingredient" : "ingredients"}
        </Text>

        {recipe.description ? (
          <Text style={styles.description}>{recipe.description}</Text>
        ) : null}
        {typeof recipe.total_time_minutes === "number" ? (
          <View style={styles.totalTime}>
            <Text style={styles.totalTimeText}>⏱</Text>
            <Text style={styles.totalTimeText}>{recipe.total_time_minutes} min</Text>
          </View>
        ) : null}
```

Replace it with:

```tsx
        <Text style={styles.title}>{recipe.title}</Text>

        {recipe.description ? (
          <Text style={styles.description}>{recipe.description}</Text>
        ) : null}

        <View style={styles.metaCard}>
          {typeof recipe.total_time_minutes === "number" ? (
            <View style={styles.totalTimeChip}>
              <Text style={styles.totalTimeText}>⏱ {recipe.total_time_minutes} min</Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Ingredients</Text>
            <Text style={styles.metaVal}>{recipe.ingredients.length}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Source</Text>
            <Text style={styles.metaVal}>{recipe.source_url ? "Imported" : "Library"}</Text>
          </View>
        </View>
```

2. Wrap the Ingredients section in a card. The Ingredients region currently starts with
`<Text style={styles.sectionTitle}>Ingredients</Text>` and ends after its closing
`)}`. Wrap that whole region in `<View style={styles.card}> ... </View>`.

3. The Equipment block: change its outer `<View>` (the one wrapping
`<Text style={styles.sectionTitle}>Equipment</Text>`) to `<View style={styles.card}>`.

4. The Steps block: change its outer `<View>` to `<View style={styles.card}>`.

5. The Tips block: change its outer `<View>` to
`<View style={[styles.card, styles.tipsCard]}>`.

6. Delete the now-unused `styles.metaPill`, `styles.totalTime`, `styles.totalTimeText`
old definitions only if you did not already replace them in Step 1 (Step 1's replacement
already removed `metaPill`/`totalTime`; `totalTimeText` is redefined — fine). Ensure no
JSX still references `styles.metaPill` or `styles.totalTime` (search the file).

- [ ] **Step 3: Verify mobile types**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: zero errors. Fix any reference to a removed style name.

- [ ] **Step 4: Verify no hardcoded hex leaked into feature code**

Run: `grep -rnE "#[0-9a-fA-F]{6}" apps/mobile/src/features/library/RecipeDetailScreen.tsx`
Expected: zero matches (all colors come from `colors.*`).

- [ ] **Step 5: Manual visual check (simulator, if available)**

If a simulator/dev client is available (`cd apps/mobile && REACT_NATIVE_PACKAGER_HOSTNAME=localhost npx expo start --ios --clear`, backend up): open a rich recipe → warm paper bg, banner hero, centered serif title, meta card, ingredient/step/tips cards, accent number badges, tips callout. Open a legacy recipe (no tutorial fields, no image) → graceful, no empty cards, gradient hero placeholder. If no simulator is available, state that this step was skipped and rely on tsc + the hex grep.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/library/RecipeDetailScreen.tsx
git commit -m "feat(mobile): warm cookbook skin for recipe detail screen"
```

---

## Phase 3 — Verification & docs

### Task 5: Full verification pass + CLAUDE.md note

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Web prod build**

Run: `npm --workspace @cooking/web run build`
Expected: succeeds, no type/CSS errors.

- [ ] **Step 2: Mobile typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Mobile design-system rule**

Run: `grep -rnE "#[0-9a-fA-F]{6}" apps/mobile/src/features apps/mobile/src/navigation apps/mobile/src/components`
Expected: zero matches (warm hex lives only in `apps/mobile/src/theme/`).

- [ ] **Step 4: Manual regression checklist (web)**

With `npm run web:dev`: on a recipe page confirm Edit, Delete (cancel the confirm),
"Meal planner" link, "Edit recipe" footer link, and "Original video" link all still work
and that `/library`, `/planner` chrome is visually unchanged.

- [ ] **Step 5: Update CLAUDE.md**

In the "Architecture notes that aren't obvious from a single file" section, add this
subsection (place it right after the "Recipe tutorial fields" subsection added in
sub-project A):

```markdown
### Recipe view skin (sub-project E)

The recipe detail view (web `apps/web/app/recipe/[id]/page.tsx` + `.recipe-editorial*`
rules in `globals.css`; mobile `RecipeDetailScreen.tsx`) uses a "Warm Cookbook" skin
**scoped to the recipe view only** — it does not change app chrome or other pages. Web
defines the palette as `--recipe-*` custom properties on `.recipe-editorial`; mobile uses
warm tokens in `apps/mobile/src/theme/` (`recipePaper`, `recipeCard`, `recipeLine`,
`accent`, `accentSoft`, `tipsCallout`) + the `typography.recipeTitle` serif preset. Web
is two-column (sticky meta/ingredients/equipment rail + steps/tips main) above 900px and
single column below; mobile is always single column. A future app-wide restyle (E2) would
make this skin global and is tracked as a follow-up. Presentation-only: no schema/API.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record recipe view warm skin (sub-project E) in CLAUDE.md"
```

- [ ] **Step 7: Finish the branch**

Use superpowers:finishing-a-development-branch to decide merge/PR. Reminder: web ships
via Vercel on merge to `main`; mobile ships on its own EAS cadence (no backend deploy
needed — this sub-project has no backend changes).

---

## Notes for the implementing agent

- **Presentation-only.** If any task seems to require a schema/API/shared-package change,
  stop — the design forbids it; you've misread the task.
- **Scope discipline.** Every web rule stays under `.recipe-editorial`. Never edit a
  global token or a non-recipe selector. Never touch nav/button/card styles used
  elsewhere.
- **No-hex rule is mobile-only.** Literal warm colors in web `globals.css` (scoped) are
  fine and intended. In `apps/mobile/src/**` outside `theme/`, zero hex — use tokens.
- **Legacy safety carried from sub-project A.** Every section's presence guard must
  survive the restyle. Verify a recipe with no description/time/steps/tips/equipment and
  no image looks intentional, not broken, on both platforms.
- **Type-name drift.** After Task 3 the new tokens are `colors.accent`, `colors.accentSoft`,
  `colors.recipePaper`, `colors.recipeCard`, `colors.recipeLine`, `colors.tipsCallout`
  and `typography.recipeTitle` — use these exact names in Task 4. `grep` the theme files
  before locking names if anything looks off.
- **OPENAI_API_KEY** is irrelevant here (no extraction). Use any existing library recipe
  to exercise the UI; create one rich recipe + keep one legacy/empty recipe for the
  legacy-safety checks.
```
