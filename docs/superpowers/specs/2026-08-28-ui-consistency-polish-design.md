# Chef World UI Consistency Polish

**Date:** 2026-08-28

**Status:** Approved through the 2026-08-28 UI audit and the follow-up request to implement it

## Goal

Polish the current web and mobile interfaces without starting another redesign. Keep the existing warm palette, waterfall library, bounded weekly planner, vertical mobile shopping flow, and clarified edit/import structure.

## Scope

1. Use Inter for product/navigation headings on both platforms. Keep Source Serif 4 only for recipe-specific editorial titles.
2. Keep the web authentication hero on desktop, and add a compact Chef World brand lockup to the mobile/tablet auth panel where the hero is hidden.
3. Keep the mobile Library focused on the original My/Public collection list without an inline search-and-tag toolbar. Keep the clearer people icon for friend search.
4. Preserve the original two-column desktop Shopping categories even while a product panel is open. Keep product choices stacked vertically inside their category and retain the single-column phone layout.
5. Render responsive web navigation as an anchored overlay so opening it does not increase header height or push page content.
6. Keep Save/Cancel reachable while scrolling long web recipe-edit and import-review forms.
7. Keep Start/Open Cook as the recipe-detail primary action, Edit and Planner as secondary actions, and move Delete into a clearly labelled overflow menu.

## Constraints

- Do not change backend APIs, recipe data, meal-planning behavior, shopping lookup behavior, or import parsing.
- Do not create a new component library or rewrite `globals.css` wholesale.
- Do not force desktop layouts onto native screens; share meaning and typography roles while retaining platform-native interaction.
- Preserve English and Chinese labels, keyboard navigation, VoiceOver semantics, and minimum 44px/point touch targets.
- Use existing design tokens and components wherever they already fit.

## Verification

- Web Vitest for component semantics and action hierarchy.
- Mobile Jest/RNTL for search and tag filtering.
- Existing desktop and phone Playwright suites for shell, Shopping, recipe workflow, and import review.
- Rendered desktop and 390px-wide browser checks with screenshots, console inspection, and at least one interaction per changed flow.
