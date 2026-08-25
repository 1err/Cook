# UI Reset: Import Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current web import wall-of-fields with an explicit Source → Review flow and a focused draft editor.

**Architecture:** Keep parsing and save endpoints unchanged while splitting source entry and review into focused components managed by the existing page state. The review editor preserves the full Recipe payload but exposes only approved fields.

**Tech Stack:** Next.js 14, React 18, TypeScript, CSS Modules, Testing Library, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-chef-world-cross-platform-ui-reset-design.md`

## Global Constraints

- Source modes remain YouTube captions and pasted recipe text/transcript.
- Optional title, notes, and tags are collapsed by default.
- No ingredient-notes editor and no step-image authoring control.
- Do not display servings.
- Back to source is above the Review title, never inline with it.
- Remove bottom explanatory cards.
- Successful save opens `/recipe/{savedId}`.
- Preserve existing payload fields and API routes.

---

### Task 1: Source step and optional details

**Files:**
- Create: `apps/web/app/import/ImportSourceStep.tsx`
- Create: `apps/web/app/import/ImportSourceStep.test.tsx`
- Create: `apps/web/app/import/ImportFlow.module.css`
- Modify: `apps/web/app/import/page.tsx`

**Interfaces:**
- Produces: `ImportSourceValues` with `mode`, `url`, `transcript`, `notes`, `title`, and `libraryTags`.
- Produces: `ImportSourceStep({ values, parsing, error, onChange, onSubmit })`.
- Review task consumes the existing parsed `Recipe` object.

- [ ] **Step 1: Write failing source-flow tests**

```tsx
render(<ImportSourceStep values={emptyValues} parsing={false} error={null} onChange={onChange} onSubmit={onSubmit} />);
expect(screen.getByRole("tab", { name: "YouTube link" })).toHaveAttribute("aria-selected", "true");
expect(screen.queryByLabelText("Title (optional)")).not.toBeVisible();
await user.click(screen.getByRole("button", { name: "Optional details" }));
expect(screen.getByLabelText("Title (optional)")).toBeVisible();
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --workspace @cooking/web test -- ImportSourceStep.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement source modes and collapsed details**

Use an accessible tablist for modes and a button with `aria-expanded` for optional details. Disable Create draft until the active source has text. Keep the caption hint in link mode and preserve input on parsing failure.

- [ ] **Step 4: Integrate existing parsing calls**

Keep `/recipes/parse/link` and `/recipes/parse/transcript`. On success, set `draftRecipe`; on error, keep source values and show the error inside `ImportSourceStep`.

- [ ] **Step 5: Run tests**

Run: `npm --workspace @cooking/web test -- ImportSourceStep.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/import/page.tsx apps/web/app/import/ImportSourceStep.tsx apps/web/app/import/ImportSourceStep.test.tsx apps/web/app/import/ImportFlow.module.css
git commit -m "feat(import): focus recipe source entry"
```

### Task 2: Draft review workspace

**Files:**
- Create: `apps/web/app/import/DraftRecipeEditor.test.tsx`
- Modify: `apps/web/app/import/DraftRecipeEditor.tsx`
- Modify: `apps/web/app/import/StepListEditor.tsx`
- Modify: `apps/web/app/import/StringListEditor.tsx`
- Modify: `apps/web/app/import/ImportFlow.module.css`
- Modify: `apps/web/app/import/page.tsx`

**Interfaces:**
- Consumes: parsed `Recipe` and `onChange(next: Recipe)`.
- Produces: `DraftRecipeEditor` with overview/content columns and unchanged save payload.

- [ ] **Step 1: Write failing review tests**

```tsx
render(<DraftRecipeEditor draft={draft} onChange={onChange} onBack={onBack} onSaveSuccess={onSaveSuccess} />);
expect(screen.getByRole("heading", { name: "Review recipe" })).toBeVisible();
expect(screen.getByRole("button", { name: "Back to source" })).toBeVisible();
expect(screen.queryByText(/Errors stay local/i)).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: /Add image/i })).not.toBeInTheDocument();
expect(screen.queryByPlaceholderText(/Notes/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --workspace @cooking/web test -- DraftRecipeEditor.test.tsx`

Expected: FAIL against the current card-plus-long-form review.

- [ ] **Step 3: Implement approved review fields**

Render overview fields for image, image URL, title, description, total time, and tags. Render ingredient rows with amount and ingredient only. Render text steps without image controls. Tips and equipment start collapsed but remain editable when opened.

Preserve hidden legacy fields when producing updates:

```ts
nextIngredients[index] = { ...draft.ingredients[index], quantity, name };
```

- [ ] **Step 4: Separate back/title/actions and navigation**

Render Back on a dedicated row above `Review recipe`. Keep a clear Save action. Change successful navigation in `page.tsx` to `router.push(`/recipe/${savedId}`)`.

- [ ] **Step 5: Run focused and integration tests**

Run: `npm --workspace @cooking/web test -- DraftRecipeEditor.test.tsx ImportSourceStep.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/import/page.tsx apps/web/app/import/DraftRecipeEditor.tsx apps/web/app/import/DraftRecipeEditor.test.tsx apps/web/app/import/StepListEditor.tsx apps/web/app/import/StringListEditor.tsx apps/web/app/import/ImportFlow.module.css
git commit -m "feat(import): rebuild recipe draft review"
```

### Task 3: Import responsive and browser flow

**Files:**
- Create: `apps/web/e2e/import.spec.ts`
- Modify: `apps/web/app/import/ImportFlow.module.css`

**Interfaces:**
- Consumes: completed Source and Review components.
- Produces: authenticated import browser contract across phone, tablet, and desktop.

- [ ] **Step 1: Add the failing browser flow**

Mock `/auth/me`, `/recipes/parse/transcript`, and `/recipes`. Assert Source tab switching, collapsed details, draft fields, no ingredient notes, no step images, save POST, and final `/recipe/recipe-saved` URL.

```ts
await page.getByRole("tab", { name: "Paste recipe text" }).click();
await page.getByLabel("Recipe text").fill("Cook beef with tomatoes.");
await page.getByRole("button", { name: "Create draft" }).click();
await expect(page.getByRole("heading", { name: "Review recipe" })).toBeVisible();
```

- [ ] **Step 2: Run and verify failure**

Run: `npm --workspace @cooking/web run test:e2e -- import.spec.ts --project=desktop`

Expected: FAIL until responsive selectors and flow are complete.

- [ ] **Step 3: Finish responsive layout and focus behavior**

At desktop, use two review columns. Below 840px, use one column with Back, title, fields, and Save in reading order. Ensure parsing error focus and draft-leave confirmation are keyboard reachable.

- [ ] **Step 4: Run browser tests and build**

Run: `npm --workspace @cooking/web run test:e2e -- import.spec.ts`

Run: `npm --workspace @cooking/web run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/import.spec.ts apps/web/app/import/ImportFlow.module.css
git commit -m "test(import): cover source review and save flow"
```

