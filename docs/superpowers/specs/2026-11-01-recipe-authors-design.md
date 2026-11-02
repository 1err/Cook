# Recipe author integration

The approved direction is an additive feature on deployed release `386bcfc` (Vercel deployment `dpl_GuJ6nX8WMcfscXKZx5X9pp3Kw6V3`), preserving the existing Library waterfall, natural image sizes, tag filtering, timing labels, menu maker, navigation, planner, and unrelated screens.

## Behavior

- Recipes optionally reference a canonical creator by ID. A creator has a display name and optional search aliases. Saving or copying a recipe preserves that ID; ownership never implies authorship.
- Library cards show a compact clickable author credit beneath the title. Missing credits add no placeholder clutter. Creator chips supplement, rather than replace, the existing tag filter. Creator, text, and tag filters combine and work across pagination.
- Recipe detail offers Add author / Edit author. Full recipe editing and import review expose the same optional author picker. Users can select an existing creator, add a new creator, or explicitly use their own chosen author name. No invented influencer credits or automatic credit inferred from a URL or account.
- The author picker searches existing canonical names and aliases, makes choosing an existing creator the easy path, and creates only on explicit selection. Exact Unicode/case/spacing equivalents and known aliases reuse existing identities. Different names are never guessed to be the same person. Unrelated same-name people remain an identity limitation until profile-based disambiguation is supported; no verified badges are shown.
- Planner and cooking recipe selection search titles, creator names, and aliases and display credits where duplicate dish names otherwise cannot be distinguished. Friend libraries retain credits. Web and native use the same API/type/search contract.
- Author changes are saved through the existing owned-recipe authorization boundary. A copied recipe's edited credit cannot overwrite its source. Older clients omitting author fields must preserve a saved credit.

## Data/API contract

`RecipeAuthor = {id: string, name: string, aliases: string[]}`.
`Recipe` and `RecipeSummary` gain optional nullable `author_id` and `author`. Writes use `author_id`; nested response metadata cannot rename a canonical creator.
`GET /recipes/authors?q=&limit=40` returns `RecipeAuthor[]` (authenticated, bounded); `POST /recipes/authors` accepts `{name, aliases?: string[]}` and returns the canonical `RecipeAuthor` (including reuse of exact normalized known aliases). New names are user-entered attribution directory entries, not verified accounts. Aliases cannot rename or mutate an existing identity through recipe writes.
Paginated lists accept `author_id` alongside existing `q` and `tags`. The API client uses `RecipePageOptions.authorId` and sends `author_id`. Text search includes creator name/aliases; cursors bind every filter.

## Review environment

Use a local full-app preview with a read-only snapshot of the signed-in admin's actual recipes, catalog and plan where available, backed by a disposable local database or explicit isolated preview transport. Clearly disclose preview-only saves and any illustrative data. Production writes, deployment and source pushes are outside this review step. The original main checkout contains unrelated local work and must remain untouched.

## Acceptance

Verify migration upgrade/downgrade, author identity reuse/concurrency and validation, omitted versus cleared author fields, owner authorization, both copy paths, server pagination/search/filter combinations, import/detail/editor saves, existing-creator selection, planner search and selection, natural waterfall layout at desktop and phone widths, and unrelated navigation. Exercise actual persistence locally; do not substitute screenshots for save verification.
