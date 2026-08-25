# UI Reset: Foundation and Core Web Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the shared 1280px web shell and apply the approved Chef World UI language to authentication, Library, Friends, recipe detail, and Settings.

**Architecture:** Add a small shared page-shell/header layer and focused CSS modules, then migrate core screens without changing their API calls. Recipe and friend cards share one metadata contract: title, real time when present, and at most two tags.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, CSS Modules, Vitest, Testing Library, Playwright 1.58.

**Spec:** `docs/superpowers/specs/2026-08-25-chef-world-cross-platform-ui-reset-design.md`

## Global Constraints

- Shared web shell maximum width is exactly `80rem` (1280px).
- Header and page content use the same horizontal gutter and left/right coordinates.
- Normal pages have no explanatory marketing-style subtitle below the title.
- No servings, invented piece counts, ingredient previews, or duplicated category/tag metadata.
- No new runtime dependency.
- Preserve existing API requests, authentication, friend sharing, copy behavior, localization, and accessible names.
- Do not modify `backend/.venv_fresh/` or `backend/pytest 2.ini`.

---

### Task 1: Shared shell and page header

**Files:**
- Create: `apps/web/app/components/PageShell.tsx`
- Create: `apps/web/app/components/PageShell.module.css`
- Create: `apps/web/app/components/PageShell.test.tsx`
- Modify: `apps/web/app/components/Header.module.css`
- Modify: `apps/web/app/styles/foundation.css`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Produces: `PageShell({ children, className?, size? }: { children: React.ReactNode; className?: string; size?: "default" | "narrow" })`.
- Produces: `PageHeader({ title, actions? }: { title: string; actions?: React.ReactNode })`.
- All later web tasks consume the `default` shell; authentication may use `narrow` inside the same outer alignment contract.

- [ ] **Step 1: Write failing shell component tests**

```tsx
render(<PageShell><PageHeader title="Recipes" /></PageShell>);
expect(screen.getByRole("main")).toHaveClass(styles.shell);
expect(screen.getByRole("heading", { name: "Recipes" })).toBeVisible();
expect(screen.queryByTestId("page-subtitle")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm --workspace @cooking/web test -- PageShell.test.tsx`

Expected: FAIL because `PageShell.tsx` does not exist.

- [ ] **Step 3: Implement the shell and shared width tokens**

```tsx
export function PageShell({ children, className = "", size = "default" }: PageShellProps) {
  return <main className={`${styles.shell} ${styles[size]} ${className}`.trim()}>{children}</main>;
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  return <header className={styles.pageHeader}><h1>{title}</h1>{actions}</header>;
}
```

Define one CSS contract used by `Header.module.css` and `PageShell.module.css`:

```css
:root { --cw-shell-max: 80rem; --cw-shell-gutter: clamp(1rem, 2vw, 2rem); }
.shell { width: min(calc(100% - 2 * var(--cw-shell-gutter)), var(--cw-shell-max)); margin-inline: auto; }
```

- [ ] **Step 4: Update the shell Playwright assertion**

Add coordinate assertions comparing `.PageShell_shell__*` with the header `.inner` at desktop width; require left and right deltas no greater than one pixel and document width no greater than viewport width.

- [ ] **Step 5: Run focused verification**

Run: `npm --workspace @cooking/web test -- PageShell.test.tsx Header.test.tsx`

Run: `npm --workspace @cooking/web run test:e2e -- shell.spec.ts --project=desktop`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/PageShell.tsx apps/web/app/components/PageShell.module.css apps/web/app/components/PageShell.test.tsx apps/web/app/components/Header.module.css apps/web/app/styles/foundation.css apps/web/app/globals.css apps/web/e2e/shell.spec.ts
git commit -m "feat(web): unify application shell alignment"
```

### Task 2: Library card grammar and Library layout

**Files:**
- Create: `apps/web/app/components/RecipeCard.module.css`
- Create: `apps/web/app/components/RecipeCard.test.tsx`
- Create: `apps/web/app/library/LibraryPage.module.css`
- Modify: `apps/web/app/components/RecipeCard.tsx`
- Modify: `apps/web/app/library/page.tsx`
- Modify: `apps/web/app/components/TagFilterPopover.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `PageShell` and `PageHeader` from Task 1.
- Produces: `RecipeCard` displaying `title`, optional formatted `total_time_minutes`, and two tags.
- Produces: Library tabs with values `mine`, `public`, and a link/view entry for `friends`.

- [ ] **Step 1: Write failing RecipeCard tests**

```tsx
render(<RecipeCard recipe={{ ...recipe, total_time_minutes: 55, ingredients: [{ name: "Beef" }] }} isHighlighted={false} />);
expect(screen.getByText("55 min")).toBeVisible();
expect(screen.queryByText("Beef")).not.toBeInTheDocument();
expect(screen.queryByText("Main Dish")).not.toBeInTheDocument();
expect(screen.getAllByTestId("recipe-tag")).toHaveLength(2);
```

Also render with `total_time_minutes: null` and assert that no metadata row exists.

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --workspace @cooking/web test -- RecipeCard.test.tsx`

Expected: FAIL because the current card renders ingredient preview and badge metadata.

- [ ] **Step 3: Implement the card and responsive grid**

Remove `ingredientPreview`, the favorite ornament, background-blur duplicate image, and top category badge. Render one cropped list image, title, optional time, and at most two semantic tags.

```tsx
{recipe.total_time_minutes != null ? (
  <p className={styles.time}>{recipe.total_time_minutes} min</p>
) : null}
<div className={styles.tags}>{featuredTags.map((tag) => <span data-testid="recipe-tag" key={tag}>{label(tag)}</span>)}</div>
```

- [ ] **Step 4: Migrate Library to the shared shell**

Use `PageHeader title={t("library.title")}`; remove the descriptive paragraph and separate friend CTA. Present `My recipes`, `Public`, and `Friends` as one secondary tab row, with Friends navigating to `/library/friends`. Keep search/filter/sort controls in a compact toolbar and keep all existing fetch/copy behavior.

- [ ] **Step 5: Run focused tests**

Run: `npm --workspace @cooking/web test -- RecipeCard.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/RecipeCard.tsx apps/web/app/components/RecipeCard.module.css apps/web/app/components/RecipeCard.test.tsx apps/web/app/library/page.tsx apps/web/app/library/LibraryPage.module.css apps/web/app/components/TagFilterPopover.tsx apps/web/app/globals.css
git commit -m "feat(library): simplify recipe browsing hierarchy"
```

### Task 3: Friends search, browse, and copy states

**Files:**
- Create: `apps/web/app/library/friends/Friends.module.css`
- Create: `apps/web/app/library/friends/page.test.tsx`
- Create: `apps/web/app/library/friends/FriendLibraryCard.tsx`
- Create: `apps/web/app/library/friends/FriendLibraryCard.test.tsx`
- Modify: `apps/web/app/library/friends/page.tsx`
- Modify: `apps/web/app/library/friends/[userId]/page.tsx`

**Interfaces:**
- Consumes: `PageShell`, `PageHeader`, and RecipeCard visual tokens.
- Produces: exact-email search states and `FriendLibraryCard({ recipe, state, onCopy })` where state is `"idle" | "copying" | "added"`.

- [ ] **Step 1: Write failing state tests**

```tsx
expect(screen.queryByText(/Search uses an exact email/i)).not.toBeInTheDocument();
await user.type(screen.getByRole("textbox"), "friend@example.com");
await user.click(screen.getByRole("button", { name: "Search" }));
expect(await screen.findByRole("link", { name: /Open library/i })).toBeVisible();
```

Test 404/private, network error, `Add to mine`, `Adding…`, and `Added` disabled state with mocked `apiFetch`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --workspace @cooking/web test -- friends/page.test.tsx FriendLibraryCard.test.tsx`

Expected: FAIL because the focused components and current visual/state contract do not exist.

- [ ] **Step 3: Implement Friends screens**

Use the same title/tab/toolbar/card grammar as Library. Do not show the exact-email helper before search. Show privacy guidance only in the not-found result. Preserve `/users/search`, `/users/{id}/recipes`, and copy endpoints exactly.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm --workspace @cooking/web test -- friends/page.test.tsx FriendLibraryCard.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/library/friends/Friends.module.css apps/web/app/library/friends/page.tsx apps/web/app/library/friends/page.test.tsx apps/web/app/library/friends/FriendLibraryCard.tsx apps/web/app/library/friends/FriendLibraryCard.test.tsx 'apps/web/app/library/friends/[userId]/page.tsx'
git commit -m "feat(library): integrate friend library flow"
```

### Task 4: Recipe detail, authentication, and Settings

**Files:**
- Create: `apps/web/app/recipe/[id]/RecipeDetail.module.css`
- Create: `apps/web/app/settings/Settings.module.css`
- Modify: `apps/web/app/recipe/[id]/page.tsx`
- Modify: `apps/web/app/login/page.tsx`
- Modify: `apps/web/app/register/page.tsx`
- Modify: `apps/web/app/settings/page.tsx`
- Test: `apps/web/app/settings/page.test.tsx`

**Interfaces:**
- Consumes: shared shell, controls, type, and image rules.
- Produces: detail layout with no servings and Settings sharing row with existing `setLibraryVisibility(next)` behavior.

- [ ] **Step 1: Write the failing Settings behavior test**

```tsx
render(<SettingsPage />);
expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
await user.click(screen.getByRole("checkbox", { name: /Share my library/i }));
expect(setLibraryVisibility).toHaveBeenCalledWith(true);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --workspace @cooking/web test -- settings/page.test.tsx`

Expected: FAIL until the page is testable with the shared shell and labeled control.

- [ ] **Step 3: Apply the shared visual system**

Recipe detail becomes a two-column desktop composition and single-column narrow composition. Remove any servings display. Login, register, and Settings use shared fields, buttons, shell alignment, focus styles, and local errors. Keep the Settings helper because it changes the consequence of enabling public sharing.

- [ ] **Step 4: Run verification**

Run: `npm --workspace @cooking/web test -- settings/page.test.tsx Header.test.tsx Button.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Run: `npm --workspace @cooking/web run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/app/recipe/[id]/page.tsx' 'apps/web/app/recipe/[id]/RecipeDetail.module.css' apps/web/app/login/page.tsx apps/web/app/register/page.tsx apps/web/app/settings/page.tsx apps/web/app/settings/Settings.module.css apps/web/app/settings/page.test.tsx
git commit -m "feat(web): align core account and recipe screens"
```

