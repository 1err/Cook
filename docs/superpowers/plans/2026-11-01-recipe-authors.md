# Recipe authors implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independent backend, web, and native tasks, followed by a whole-change review.

**Goal:** Integrate optional canonical creator credits throughout the existing app without redesigning its UI.
**Architecture:** A canonical author registry and recipe foreign key feed the existing paginated API. Shared types/client functions connect a reusable author picker and compact credits to the existing screens.
**Tech stack:** PostgreSQL, Alembic, FastAPI/SQLAlchemy, shared TypeScript, Next.js/React, React Native.
**Spec:** `docs/superpowers/specs/2026-11-01-recipe-authors-design.md`.

## Global constraints

- Base on deployed `386bcfc`; preserve waterfall, tags, timing, menu maker and unrelated UI.
- Nullable authors; credit is independent of account ownership.
- No production writes or deployment for the review preview.
- Keep the dirty primary checkout untouched; work in this managed worktree.

## Review focus

- Older saves omitting author metadata preserve credits; explicit null clears only the owned recipe.
- Alias conflicts and concurrent create requests cannot silently split or reassign identities.
- Search, tag, author and cursor scope compose consistently through every page.
- Keyboard/touch selection and changing accounts cannot apply stale author suggestions.
- Source and copied recipes remain independent; unknown credit is never guessed.

### Task 1: Shared contract (controller)

- [ ] Add `RecipeAuthor`, author fields on recipe and summary, pure `matchesRecipeSearch` helper, and API author methods/authorId page options.
- [ ] Write/run meaningful failing client/helper tests; implement and rerun.

### Task 2: Author persistence and API (backend agent)

- [ ] Add registry + unique normalized-name/alias mapping, recipe FK and reversible Alembic migration.
- [ ] Add validated authenticated lookup/create routes; resolve duplicate equivalent names/aliases atomically without mutating existing creators.
- [ ] Extend recipe reads, summary joins, search, cursor scopes, save and both copy paths. Preserve omitted author fields and reject unknown author IDs.
- [ ] Write failing focused tests first; run repository/API tests and disposable PostgreSQL integration tests.

### Task 3: Existing web app integration (web agent)

- [ ] Add reusable optional AuthorPicker and RecipeAuthorCredit components with existing styling and English/Chinese copy.
- [ ] Integrate import review, full edit, detail inline author editing, library credits/chips, friend credits, planner and cooking search/credits.
- [ ] Keep LibraryMasonry, tag filters, image sizing and other controls; filters must be server-backed and combine.
- [ ] Cover author selection/create/clear/failure, detail save, import payload and combined filters with focused tests.

### Task 4: Native parity (native agent)

- [ ] Add equivalent optional picker/credits to import, edit/detail, library/friends, planner and cooking selectors using the shared contract.
- [ ] Preserve native navigation and layout; verify native typecheck and focused tests.

### Task 5: Full-app review environment and verification (controller)

- [ ] Read only the admin account's recipes into an isolated local preview; apply new schema only to a disposable database.
- [ ] Verify persistence, pagination/filter behavior, author identity reuse, source-copy separation, desktop/phone waterfall and full-app navigation.
- [ ] Run relevant suites/typechecks/build; request fresh independent review and address important findings.
- [ ] Update CLAUDE.md with final API/model behavior; open the complete app preview and provide screenshots with limits stated.
