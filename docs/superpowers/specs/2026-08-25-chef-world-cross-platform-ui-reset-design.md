# Chef World Cross-Platform UI Reset

**Date:** 2026-08-25

**Status:** Approved in visual review; written specification pending final review

**Platforms:** Web and native mobile

**Supersedes:** Visual and layout decisions in the 2026-08-15 holistic UI design and the 2026-08-18 bounded desktop Planner design where this document conflicts with them. Existing business rules and backend contracts remain authoritative.

## Product Decision

Chef World adopts the approved **Culinary Workbench** direction: a restrained cookbook identity around efficient planning, shopping, and editing tools. The web app receives the larger structural reset. The native mobile app keeps its successful navigation and vertical interaction patterns while adopting the same typography, color, card grammar, spacing, and state treatments.

This is a UI and interaction redesign, not a backend redesign. Existing authentication, recipe import, sharing, meal-plan, shopping refinement, and store-product behavior remain in place unless this document explicitly changes the client flow.

## Goals

1. Make every customer-facing screen feel like one product rather than a collection of page-specific styles.
2. Give dense workflows enough width and predictable alignment on the web.
3. Replace the compressed desktop Planner with a readable weekly matrix that still keeps the full week visible.
4. Make Library, Friends, recipe detail, import review, and Shopping use the data and actions the product actually supports.
5. Preserve the useful parts of the existing mobile UI while bringing it into the same visual system.
6. Reduce decorative and explanatory UI that does not help a user complete a task.
7. Preserve keyboard, screen-reader, touch, localization, loading, error, and partial-success behavior.

## Non-Goals

- No API, database, authentication, scraper, store-cache, or LLM behavior changes.
- No servings feature. The UI must not display, infer, or edit servings.
- No new import providers or audio transcription.
- No step-image authoring in the import review flow.
- No new ingredient-notes field in the import review flow.
- No deployment or production release unless requested separately.
- The admin `/preview` cache console is not the recipe preview referred to in this design. It inherits shared shell and control styling only.

## Global Product Language

### Visual character

- Warm ivory canvas, white content surfaces, dark brown-black ink, oxblood primary action, and restrained olive status accents.
- No decorative gradients, glass panels, glow effects, ornamental textures, oversized radii, or excessive shadows.
- Separation comes primarily from spacing, borders, and clear hierarchy.
- Recipe photography is functional content. Store-product imagery uses `contain`; recipe-list imagery uses a stable crop for scanning; recipe detail shows the complete image.

### Typography

- Source Serif 4 and its CJK-aware serif fallbacks are limited to brand, page titles, recipe titles, and selected section headings.
- Inter and platform sans-serif fallbacks are used for navigation, forms, metadata, lists, planner cells, shopping rows, and long instructional content.
- Page titles, back links, actions, and content columns align to a shared baseline and are never combined into an awkward single inline cluster.
- Chinese and English use the same hierarchy without forcing identical line breaks.

### Page copy

- Normal pages do not place explanatory marketing-style paragraphs below their titles.
- Remove copy such as “Personal recipes, shared libraries, and public inspiration…” and “The checklist is always primary…”.
- Guidance remains only when it changes task success: input hints, permission requirements after a failed friend search, empty-state instructions, errors, destructive confirmations, and loading status.

### Shape and motion

- General surfaces use 8–12px radii. Larger 16px radii are reserved for modal or major grouped surfaces.
- Pills are limited to compact tags, segmented controls, avatars, and status badges.
- Motion is short and functional. Reduced-motion settings disable nonessential transitions.

## Shared Web Shell

The header and every customer-facing page use one shared shell contract.

- Define a single maximum shell width of `80rem` (1280px).
- Use the same responsive horizontal gutter token for the header inner container and page roots: 16px on narrow phones, 24px on tablet and standard desktop, and up to 32px on wide screens.
- The left edge of page content aligns with the left edge of the `CW` mark.
- The right edge of page actions and content aligns with the right edge of the account control.
- Replace the current mix of 1120px, 1200px, full-width, and page-specific inset rules with the shared shell.
- Full-bleed media is allowed only inside the shared page boundary unless a screen explicitly requires edge-to-edge mobile content.
- At 1280px and wider, Planner, Library, Shopping, Import review, and recipe detail use the full available shell width.

The header keeps Chef World, Library, Planner, Shopping, Add Recipe, and the account control. The active destination uses a restrained underline or weight change. The header remains sticky on web. Mobile keeps native stacks and the three-tab bottom navigation.

## Shared Components

The redesign builds on the existing token package and UI primitives rather than adding a new component library dependency.

Required shared concepts are:

- `AppShell` / shared page-width utility
- `PageHeader` with title, optional operational controls, and no default subtitle
- Button, IconButton, LinkButton, and inline action variants
- SearchField, TextField, TextArea, SelectField, and ValidationMessage
- Tabs and SegmentedControl
- Tag and compact status badge
- RecipeCard and FriendRecipeCard
- RecipeImage and ProductImage with distinct crop/contain rules
- EmptyState, ErrorNotice, InlineStatus, Skeleton, and local Retry
- CategorySection, GroceryItemRow, and StoreProductRow
- Dialog/drawer/sheet foundations for recipe picking and confirmations

Touched route styling moves toward route or component CSS modules. The existing global stylesheet may retain tokens, resets, shared utilities, and transitional selectors, but new route-specific styling must not continue expanding one monolithic file.

## Web Screen Designs

### Authentication

- Login and registration use the shared shell, type system, fields, and validation.
- The form is the only major surface; no decorative feature panel is required.
- Field errors stay with fields. Account-wide errors appear once above the primary action.
- Language selection remains accessible and secondary.

### Library

- Page title: `Recipes`.
- Secondary tabs: `My recipes`, `Public`, and `Friends`.
- Search, tag filter, and sort controls appear in one compact toolbar under the tabs.
- The recipe grid uses stable image ratios for quick scanning and responsive columns.
- Each card shows:
  - recipe title;
  - total time only when `total_time_minutes` exists;
  - no more than two tags.
- Cards do not display invented servings, “pieces,” ingredient previews, or a category label duplicated from the tags.
- If time is absent, the metadata row collapses rather than showing a placeholder.
- Missing and broken images use one restrained culinary placeholder.

### Friends

Friends is the third Library mode rather than a disconnected-looking utility page.

- The search form accepts an exact email and exposes loading, found, not-found/private, and error states.
- Do not show the preemptive helper paragraph explaining exact-email and sharing requirements.
- If search returns no public library, the result state may explain that the email may be unregistered or sharing may be disabled.
- A found result shows the email and `Open library`. The recipe count appears only after the friend library has loaded; the search endpoint is not expanded for this redesign.
- A friend library uses the same card grammar as Library.
- Each card has `Add to mine`, `Adding…`, or `Added` state without duplicate actions.
- If sharing is disabled after navigation, show a local unavailable state and a clear route back to search.
- The friend detail route remains read-only until the user explicitly copies a recipe.

### Recipe detail

- Use a composed two-column desktop layout: image/identity on one side and ingredients/method on the other.
- The complete recipe image remains visible and is not cropped in the detail view.
- Title, description, total time, and tags align cleanly; servings are not present.
- Ingredients, method, tips, and equipment use content-appropriate structures instead of a card around every block.
- Edit and other supported actions share one consistent action area.
- Narrow screens collapse to one natural reading column.

### Import: source phase

The recipe preview in this design is the draft-review phase after parsing, not the admin `/preview` route.

- Page title: `Add recipe`.
- Show a two-step operational indicator: `Source` and `Review`.
- Source selection uses two clear modes: `YouTube link` and `Paste recipe text`.
- The selected source field is the dominant control.
- YouTube mode keeps the existing caption requirement hint.
- Title override, notes, and tags move into a collapsed `Optional details` region.
- The primary action is `Create draft` or the localized equivalent.
- Parsing progress stays in the primary action and does not clear entered content.
- Source-specific errors render beside the source area.

### Import: review phase

- `Back to source` appears on its own row or breadcrumb line above the page title. It is never inline on the same baseline as `Review recipe`.
- The desktop review uses the shared shell and a two-column workspace:
  - overview column for recipe image, title, description, total time, image URL/upload, and tags;
  - content column for ingredients, method, tips, and equipment.
- Ingredient rows show amount and ingredient only, plus removal/reordering controls. Do not render an ingredient-notes editor.
- Method steps are text-focused. Do not render `Add image` or step-image upload controls.
- Existing model fields not exposed by the new form remain preserved when possible; the redesign does not delete backend fields or historical recipe data.
- Tips and equipment may be collapsed sections until opened.
- Remove the three bottom explanatory cards about local errors, leaving, and save destination.
- `Save recipe` is visible in the review action area. Save errors remain local and the draft stays editable.
- Going back preserves source input. Leaving a changed draft requires confirmation.
- Successful web save opens the finished recipe detail, matching mobile behavior.

### Planner

The approved desktop Planner is a row-based weekly matrix.

- The recipe library stays on the left because it is the origin of the drag interaction.
- The weekly board stays on the right.
- Board columns are `Day`, `Breakfast`, `Lunch`, and `Dinner`.
- Monday through Sunday are rows, giving every meal cell substantially more width than the previous seven narrow day columns.
- The recipe rail and board use one shared computed workspace height.
- The board is a grid with one header row and seven equal day rows, so the board cannot stretch into an empty bottom band when the recipe rail is taller.
- The rail header contains search, tag filtering, and sorting. The recipe list scrolls inside the bounded workspace.
- The Planner toolbar contains the week range, title, previous, today, and next controls.
- Remove the duplicate `Shopping list` shortcut from the Planner toolbar. Shopping remains in primary navigation.

Meal-cell composition adapts by recipe count:

- **One recipe:** large thumbnail, title up to two lines, and useful time metadata when available.
- **Two recipes:** two equal compact rows with thumbnail and readable title.
- **Three recipes:** three compact rows with thumbnail and readable single-line title.
- **Four or more:** show the first two recipes plus a clear `+ N more` control that opens the complete meal. Do not shrink cards into unreadable fragments.

Drag-and-drop remains available on desktop. Clicking or keyboard-activating an empty or populated cell opens the accessible picker. Remove, add-another, optimistic saving, rollback, focus restoration, and complete accessible names remain intact.

At tablet and phone widths, Planner uses a selected-day/week-strip layout with vertical Breakfast, Lunch, and Dinner sections. It does not attempt to reproduce the desktop matrix.

### Shopping

Shopping preserves the existing two-phase mental model.

#### Original list

- Show the chosen week and planned-meal context.
- Place `Prepare smart list` in a clear content-level preparation panel, not as a lone top-right page action.
- The action includes concise operational information such as planned dish or raw ingredient count when existing data provides it.

#### Smart list

- Replace large decorative smart-mode hero treatments with a compact mode/status bar.
- The bar exposes item counts, `Back to original`, stale/refresh state when necessary, and `Load all Weee picks` when applicable.
- Categories are arranged as two independently stacked desktop columns when width permits and a single column on narrow screens.
- Category headers use text and count only. Do not add decorative produce/meat category icons.
- Grocery items show checkbox, name, suggested amount, item menu, and `View products` / `Hide products`.
- Checked items move into an `Already have` subsection inside the same category.

Store-product results remain attached to the grocery item that requested them.

- Product options render as vertical rows on both web and mobile.
- Each row shows a contained product image, product name, price, and verified external store link.
- Do not use a horizontal desktop product-card grid that creates large empty image areas.
- Loading, empty, unsafe-link, error, and retry states remain local to the expanded grocery item.
- One failed store lookup must not block other groceries or the checklist.

### Settings and admin

- Settings uses the shared shell, field grammar, section spacing, confirmations, and inline status.
- Library sharing remains easy to find and accurately reflects saved state.
- Admin surfaces inherit global tokens and shell alignment but do not drive customer-facing navigation or visual hierarchy.

## Native Mobile Design

The mobile app keeps its native navigation and successful vertical layouts.

- Bottom tabs remain Library, Planner, and Shopping.
- Import remains a native modal.
- Add actions remain native navigation-bar actions.
- Library uses the same title/time/tags card grammar as web with phone-appropriate columns.
- Planner keeps the week strip and day-focused vertical meal sections.
- Shopping remains very close to the current category-card and vertically expanded product-row design.
- Remove newly invented decorative category icons; use clean text category headers and counts.
- Import uses the same Source → Review phases. Optional details stay collapsed, review becomes a natural single-column editor, and Save remains in the navigation action area.
- Mobile review also omits ingredient notes and step-image authoring.
- Dynamic Type, safe areas, VoiceOver, and minimum 44-point touch targets remain required.

## Data and State Behavior

- Existing API requests and payload shapes remain unchanged unless client cleanup is required to preserve hidden legacy fields.
- The redesign must not synthesize missing time, servings, recipe counts, product availability, or sharing state.
- Recipe-card time appears only when real time data exists.
- Local optimistic updates remain limited to interactions that can be reliably rolled back.
- Planner mutations preserve current rollback and focus behavior.
- Friend-copy state derives from existing recipe and catalog-source identifiers.
- Shopping refinement, staleness detection, checked/hidden state, product caching, concurrency, and safe-link validation remain intact.
- Import parsing never saves automatically. The user reviews and explicitly saves the draft.

## Error, Empty, and Loading States

- Skeletons preserve final layout for initial content loading.
- Compact action spinners remain inside stable action bounds.
- Empty states contain one useful next action and no generic marketing copy.
- Errors stay local whenever the rest of the screen remains usable.
- Friend search distinguishes not found/private from network failure.
- Import distinguishes parsing, image upload, validation, and save failures.
- Shopping distinguishes refining, product loading, no products, stale results, unsafe links, partial failures, and retry.
- Broken images never show browser-native broken-image chrome.

## Accessibility and Localization

- Web targets WCAG 2.2 AA contrast and interaction behavior.
- All actions are keyboard reachable with visible focus.
- Drag-and-drop always has an equivalent click/keyboard path.
- Truncated titles retain complete accessible names and native hover titles where appropriate.
- Dialog, drawer, popover, tab, checkbox, and status semantics remain explicit.
- State is never communicated by color alone.
- English and Chinese layouts are verified at phone, tablet, laptop, and wide-desktop sizes.
- CJK recipe titles and shopping rows use appropriate line height and do not inherit Latin-only metrics.

## Verification Strategy

### Automated web verification

- Shared shell alignment: header and route content share the same left and right coordinates at 1280px and 1440px.
- No horizontal document overflow at phone, tablet, laptop, or wide desktop sizes.
- Library cards show only supported metadata and no duplicated tag/category values.
- Friend search covers loading, found, not-found/private, network failure, open-library, copying, and already-added states.
- Recipe detail renders without servings and preserves full-image behavior.
- Import covers source switching, collapsed optional details, parsing, source errors, draft preservation, ingredient editing without notes, text-only step editing, save errors, unsaved-leave confirmation, and navigation to saved detail.
- Planner covers left rail, row matrix, shared panel height, one/two/three/four-plus recipes, drag/drop, picker, add/remove, focus restoration, rollback, and responsive day layout.
- Shopping covers original/refined modes, preparation placement, stale refresh, category columns, vertical product rows, checked items, bulk loading, per-item loading/error/retry, and safe links.
- Existing Header, Button, account-menu, shopping coordinator, and product-cache tests remain green.

### Automated mobile verification

- Navigation and tab tests remain green.
- Library card metadata, friend search/copy, Planner day sections, Shopping category/product expansion, and Import Source → Review flows receive focused component tests.
- Accessibility labels and Dynamic Type-safe layout are covered where the current test harness supports them.

### Visual verification

- Governed screenshots at desktop, tablet, and phone widths for shell, Library/Friends, recipe detail, Import source/review, Planner, and Shopping with one expanded product list.
- Verify English and Chinese examples, long recipe titles, missing images, and dense multi-recipe meals.
- Inspect screenshot output at original resolution before accepting baselines.

### Build verification

- Web unit suite, TypeScript compilation, and production build.
- Mobile Jest suite and TypeScript compilation.
- Browser flow verification for authenticated Library → Import → Review → Save → Detail, Planner mutations, Friend copy, and Shopping refinement/product expansion.

## Implementation Boundaries and Sequence

The implementation is one coordinated program delivered in verifiable slices:

1. Shared tokens, web shell, page-width alignment, and shared primitives.
2. Web Library, Friends, recipe detail, authentication, and Settings.
3. Web Import Source → Review flow.
4. Web Planner matrix and responsive Planner.
5. Web Shopping original/refined flow and vertical product rows.
6. Mobile token/component alignment and screen-specific refinements.
7. Cross-route accessibility, localization, screenshot, and build verification.

Each slice must leave existing business behavior working and tests green. The redesign does not wait until the final slice to verify shared primitives or critical flows.
