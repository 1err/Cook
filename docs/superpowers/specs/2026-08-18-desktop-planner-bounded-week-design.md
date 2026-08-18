# Desktop Planner Bounded Week Design

**Status:** Approved

## Product decision

Chef World keeps the existing seven-day by three-meal Planner on desktop, but presents it as one bounded workspace instead of a full-height sidebar beside a compressed board. The phone and tablet Planner remain visually and behaviorally unchanged.

The design combines the library-plus-calendar model used by Plan to Eat and Samsung Food with a separate, image-rich recipe chooser. It intentionally does not move to a focused-day or vertically scrolling week layout because the desktop priority is retaining the complete weekly overview.

## Problems to solve

1. The saved-recipes rail currently reads as an unbounded page sidebar. Its background continues toward the bottom of the viewport without a clear relationship to the weekly board.
2. Meal slots reserve a small fixed row height for each dish. One, two, or three dishes therefore sit at the top of a larger slot and leave unusable blank space.
3. The Add flow reuses the rail-oriented recipe presentation. Long titles and small thumbnails make the desktop chooser feel like a text list rather than a visual recipe picker.
4. Long recipe names must remain understandable without widening the Planner beyond the restrained Library/Shopping page width.

## Desktop layout

- The page remains centered at `max-width: 70rem`.
- The toolbar spans the full Planner width.
- Below the toolbar, the saved-recipes rail and weekly board occupy the same bounded grid row.
- The rail uses `clamp(13rem, 17vw, 14rem)` and the remaining width belongs to the seven-day board.
- The rail receives a complete card boundary, rounded corners, and hidden outer overflow. Its search/filter header stays fixed while only the recipe list scrolls.
- The rail and weekly board have the same bottom edge. At the governed `1280 × 800` desktop viewport their bottom coordinates differ by at most one CSS pixel.
- All seven day columns and all 21 meal slots remain visible at `1280 × 800` without document scrolling or horizontal overflow.
- The existing Planner title scale and absence of a Planner “New recipe” action remain unchanged.

## Meal-slot composition

The available recipe area inside each meal slot is divided by the number of scheduled dishes:

- **One dish:** the dish card fills the available recipe area. Its title may use two lines.
- **Two dishes:** two equal-height rows fill the available recipe area. Each title uses one line.
- **Three dishes:** three equal-height rows fill the available recipe area. Each title uses one line.
- **Four or more dishes:** the viewport retains the same three-row geometry and scrolls vertically inside the slot. The compact localized overflow cue remains visible.

Every visible title must end cleanly rather than clip through adjacent controls. The complete title remains in the existing accessible action name and is also exposed as a native hover title. Removal focus handoff, keyboard traversal, drag/drop, and Add-another behavior remain intact.

## Desktop Add picker

- Clicking an empty slot or Add another opens the existing modal interaction, restyled on desktop as an image-rich recipe chooser.
- The desktop sheet is `min(50rem, calc(100vw - 3rem))` wide and centered.
- Search and tag filters stay fixed above the results.
- Results render as a three-column grid at the governed desktop viewport.
- Each card includes a `16 / 9` thumbnail or the existing warm placeholder, a title clamped to two lines, secondary recipe metadata, and a clearly labeled Add action.
- Only picker cards contain Add actions. Opening the modal must not expose duplicate Add buttons in the background rail.
- Choosing a recipe still performs the same optimistic meal-plan mutation and closes the modal.
- Modal close, backdrop, keyboard, and accessible-name behavior remain functional.

## Responsive constraint

All new layout and picker presentation rules are scoped to `@media (min-width: 1024px)`. At `1023px` and below:

- days remain vertically stacked;
- document scrolling remains enabled;
- the existing phone-friendly guide remains visible;
- the picker remains the current bottom sheet with its current one-column list presentation;
- drag affordances remain disabled as they are today;
- no mobile navigation, typography, spacing, or meal-card changes are introduced.

## Data and architecture

- No API, database, meal-plan model, localization-copy, or authentication changes are required.
- The recipe collection rendering must distinguish rail and picker modes so drag behavior and Add actions are not duplicated.
- No new runtime dependency is permitted.
- Existing design tokens, Inter UI typography, and Source Serif editorial typography remain authoritative.

## Accessibility

- The rail remains an `aside`; the weekly board remains the page’s main planning content.
- Recipe picker results are keyboard reachable and retain full accessible recipe titles.
- Truncated visual titles do not truncate accessible names.
- The in-slot scroll region remains focusable only when more than three recipes exist.
- Focus restoration and removal focus handoff regressions must remain covered.
- The desktop picker retains a named modal dialog and a visibly labeled Close control.

## Verification

Automated verification must cover:

1. Rail and board bottom alignment, rail internal overflow, centered 70rem shell, 7 columns, 21 slots, and no desktop document overflow at `1280 × 800`.
2. One-, two-, and three-dish equal-fill geometry, plus a fourth dish below the directly visible three-row viewport.
3. Two-line single-dish titles, single-line multi-dish titles, and complete accessible/native titles.
4. A three-column desktop picker with visible `16 / 9` media, metadata, one Add action per result, and no rail Add actions.
5. Existing phone/tablet stacking and bottom-sheet presentation without geometry changes.
6. Desktop keyboard, drag/drop, add, remove, save-error, and navigation flows.
7. Updated governed Darwin and official Playwright 1.58 Linux desktop Planner screenshots, each inspected at original resolution and compared normally after regeneration.

## Release

After unit, TypeScript, production-build, desktop/responsive browser, accessibility, and platform screenshot gates pass, merge the reviewed branch to `main`, push GitHub, deploy the Vercel production project, and verify `https://chef-world.com/planner` serves the new bounded desktop experience without changing the phone layout.
