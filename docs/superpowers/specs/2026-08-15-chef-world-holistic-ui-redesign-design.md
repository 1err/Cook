# Chef World Holistic UI Redesign

**Date:** 2026-08-15

**Status:** Approved in conversation; written specification pending final review

**Platforms:** Web and iOS, treated as equally important

## Context

Chef World has a coherent product workflow—import a recipe, review and save it, organize a library, plan a week, and prepare a shopping list—but its visual implementation grew page by page. The web app now mixes editorial, Stitch-inspired, cookbook, Material, inline, and page-specific styles in a monolithic stylesheet. The iOS app has an early token system and shared primitives, but feature screens still make independent styling decisions.

The redesign is not a color swap. It establishes one product identity, one semantic design system, native platform behavior, predictable component states, and a staged path for replacing existing UI without breaking working functionality.

The scraping-reliability project is deliberately separate. The UI redesign will create the states and components that scraping later needs, but it will not change scraper behavior, caching, matching, or backend contracts.

## Goals

1. Give Chef World a mature, recognizable visual identity across web and iOS.
2. Preserve the existing product workflow and API behavior while improving clarity, consistency, accessibility, and responsiveness.
3. Make web and iOS feel like the same product without forcing identical controls or navigation behavior.
4. Establish reusable semantic tokens and platform-native component libraries.
5. Preserve complete recipe images at their natural aspect ratios instead of cropping them into uniform frames.
6. Define every important loading, empty, partial-success, error, retry, offline, disabled, and destructive state.
7. Replace the current styling incrementally so each vertical slice can be verified on staging before production.

## Non-goals

- Adding new import providers or changing recipe extraction.
- Changing meal-planning behavior or shopping-list business logic.
- Improving store scraping, product matching, cache behavior, or fetch latency in this project.
- Adding subscriptions, StoreKit, nutrition tracking, AI meal plans, or social feeds.
- Sharing rendered React components between web and React Native.
- Rewriting the entire frontend in one release.

## Approved Direction Summary

- **Visual identity:** Warm Modern Editorial.
- **Platform priority:** Web and iOS are equal.
- **Library density:** Balanced collection—not an oversized gallery or compact database.
- **Recipe images:** Natural-ratio masonry/waterfall; complete originals remain visible.
- **Primary navigation:** Library, Planner, and Shopping.
- **Recipe import:** A global action rather than a navigation destination.
- **Web add action:** Persistent `Add Recipe` header button.
- **iOS add action:** Native top-right plus button.
- **Contextual add action:** A larger inline action is allowed in empty states; duplicate persistent add buttons are not.

## Product and Visual Principles

### Warm, not themed

The product should feel connected to food and home cooking without resembling a scrapbook, rustic recipe blog, or faux-paper notebook. Warmth comes from color, photography, typography, and language—not decorative textures, excessive borders, or ornamental effects.

### Editorial, not fragile

Serif typography and generous composition create hierarchy, while core controls remain direct and highly readable. Editorial styling must never reduce scan speed, hide actions, or make dense planning and shopping screens harder to use.

### Restrained, not generic

Chef World avoids excessive gradients, glass effects, shadows, pills, oversized radii, and decorative badges. A small set of repeated decisions creates identity more effectively than a unique visual treatment for every page.

### Honest content

Recipe photography is content, not decoration. Images retain their original aspect ratio and are never silently cropped to make a grid line up. Loading and failure states also remain honest: unavailable or stale product data is labeled rather than disguised.

### Native interaction, shared meaning

Semantic roles are shared across platforms. Web uses keyboard, hover, focus, responsive headers, and drag-and-drop. iOS uses navigation bars, sheets, gestures, haptics, safe areas, and Dynamic Type. Components look related but behave according to their platform.

## Design Tokens

A framework-neutral `packages/design-tokens` workspace will be the source of truth. It will generate or export CSS custom properties for web and typed values for React Native. Feature code consumes semantic roles rather than raw values.

### Core color roles

| Role | Initial value | Use |
| --- | --- | --- |
| Canvas | `#FBF8F2` | Primary warm application background |
| Surface | `#FFFFFF` | Cards, menus, sheets, inputs |
| Subtle surface | `#F3ECE4` | Secondary controls and grouped sections |
| Ink | `#2F2621` | Primary text and dark navigation surfaces |
| Muted ink | `#6F6259` | Secondary text and metadata |
| Terracotta | `#A64B34` | Primary actions, focus accents, selected emphasis |
| Terracotta strong | `#8F3E2B` | Hover/pressed primary actions |
| Sage | `#687761` | Secondary food-oriented accent and positive context |
| Divider | `#E6DED6` | Borders and separators |
| Error | `#B42318` | Destructive and error states |
| Success | `#3F6B4A` | Confirmed success states |

These values may move only when accessibility testing requires a contrast correction; their semantic roles and visual relationships remain fixed.

### Typography

- **Display and recipe titles:** Source Serif 4, with Iowan Old Style, Songti SC, and serif fallbacks.
- **UI and body:** Inter, with SF Pro, PingFang SC, system sans-serif fallbacks.
- Serif is limited to page titles, recipe titles, and selected editorial callouts.
- Controls, forms, metadata, lists, shopping items, planner slots, and long body content use the sans-serif family.
- Type roles include display, page title, section title, card title, body, emphasized body, metadata, label, and caption. Screens do not define arbitrary font sizes.

### Spacing, shape, and elevation

- Spacing uses a 4-point base scale: 4, 8, 12, 16, 24, 32, 40, 56, and 72.
- General radii are 8, 12, 16, and 24 pixels/points.
- Fully rounded shapes are reserved for avatars, icon buttons, compact tags, and truly pill-shaped segmented controls.
- Elevation has three semantic levels: raised control, card/menu, and modal/sheet.
- Borders and spacing should provide most separation. Shadows remain subtle and never substitute for hierarchy.
- Motion uses short, functional transitions. Reduced-motion settings disable nonessential movement.

### Icons

Web and iOS use matching semantic icon names and a consistent rounded stroke style. Platform implementations may use different libraries when needed, but a central mapping prevents the same action from receiving unrelated symbols. Material icon fonts are removed from the web shell once equivalent bundled icons exist.

## Image System

### Recipe library

- The library uses a balanced masonry/waterfall layout.
- Web uses one column on narrow screens, two at medium widths, and three at desktop widths.
- iOS uses a two-column masonry layout where width permits and a single column at accessibility sizes that make two columns unreadable.
- Images render at their natural aspect ratio with `height: auto`/equivalent measured layout behavior.
- No `cover` crop is used for library recipe imagery.
- Card metadata follows each image and does not require card bottoms to align.
- Extremely tall images receive a documented maximum display height only if the complete image can still be opened without crop; the default presentation favors the natural ratio.

### Recipe detail

- The hero image renders at its natural ratio.
- Web may constrain maximum content width but not the visible image content.
- iOS displays the complete image in the scroll flow.

### Product results

Store-product thumbnails use a consistent canvas with `contain`, because packaging images need comparison and alignment rather than editorial presentation. This distinction prevents recipe-photo rules from weakening shopping usability.

### Missing and loading imagery

- Missing images use a restrained brand placeholder with a simple culinary icon and neutral surface.
- Loading images reserve known or estimated space to minimize layout shift.
- Broken images fall back without leaving browser-native broken-image artifacts.

## Navigation and Information Architecture

### Primary destinations

1. **Library** — personal recipes, public catalog, and friend/shared libraries.
2. **Planner** — weekly meal schedule and recipe selection.
3. **Shopping** — grocery checklist, smart refinement, and store suggestions.

### Web shell

- Persistent header contains Chef World, Library, Planner, Shopping, `Add Recipe`, and account avatar.
- Active navigation uses a restrained state rather than a large pill.
- Account menu contains profile/settings, language, and logout.
- Admin-only tools move into an admin section of the account menu and never appear in normal primary navigation.

### iOS shell

- Bottom tab bar contains Library, Plan, and Shop.
- The current tab owns a native navigation stack.
- A top-right plus opens Add Recipe from each core destination.
- Account/profile opens from a navigation-bar avatar rather than consuming a primary tab.

### Add Recipe behavior

- Add Recipe opens a focused modal flow on iOS and a focused route/modal presentation on web.
- Closing returns to the initiating destination.
- Saving opens the new recipe detail view.
- Only one persistent add affordance is visible at a time.
- Empty states may include a larger inline `Add your first recipe` action.
- A floating action may replace the header action only in a future full-screen context where the header is intentionally unavailable; it never duplicates a visible header action.

### Library secondary navigation

Personal, public, and friend/shared libraries live under Library as a clear secondary layer. Search and filters remain scoped to the active collection. Secondary navigation must not look like another global tab bar.

## Component Architecture

The project shares tokens and behavior contracts, not rendered components.

### Web primitives

Reusable web primitives live under a focused UI directory rather than inside page files or one global stylesheet. Initial primitives include:

- Button and IconButton
- LinkButton
- Card and InteractiveCard
- TextField, TextArea, SearchField, and SelectField
- Chip, Tag, and SegmentedControl
- PageHeader and SectionHeader
- Menu, Popover, Dialog, and Drawer
- Tabs for secondary navigation
- EmptyState, ErrorNotice, InlineStatus, Skeleton, and Spinner
- Toast/announcement system
- NaturalRatioImage and ProductImage
- FormField and ValidationMessage

### iOS primitives

React Native receives equivalent semantic primitives implemented with native behavior:

- Button and IconButton
- Card and PressableCard
- TextField, SearchField, and FormField
- Chip and SegmentedControl
- ScreenHeader actions through navigation options
- Menu/action sheet, modal sheet, and confirmation dialog
- EmptyState, ErrorNotice, InlineStatus, Skeleton, and Spinner
- NaturalRatioImage and ProductImage
- Accessible list row and swipe/action patterns where appropriate

### Component-state contract

Every applicable component defines default, hover, pressed, focus-visible, selected, disabled, loading, success, error, and destructive states. A page may not invent a new state treatment when an existing semantic state applies.

## Screen Designs

### Authentication

- Use a calm branded composition with one clear form hierarchy.
- Login and registration share form primitives and validation behavior.
- Language selection is accessible but visually secondary.
- Errors appear next to the affected field when possible; authentication-wide errors appear above the primary action.

### Library

- Balanced natural-ratio masonry is the dominant content area.
- Search and filters are close to the active collection.
- Cards show title, time when available, and no more than two useful tags.
- Ingredient previews are optional secondary information and must not overwhelm title scanning.
- Personal, public, and shared modes use the same card grammar and clearly different available actions.

### Recipe detail

- Natural-ratio image and editorial title establish identity.
- Ingredients, steps, equipment, and tips use structures suited to their content rather than generic cards around every section.
- Web may use a two-column layout with a stable ingredient rail when space permits.
- iOS uses a focused single-column reading flow.
- Edit, share, add-to-plan, and catalog/admin actions use one consistent action menu.

### Import and editing

- Preserve the existing paste/link → review → save workflow.
- Make the current stage, primary action, and unsaved state unmistakable.
- Imported drafts and existing recipes reuse the same editor field components.
- Image upload, ingredient rows, steps, tags, time, equipment, and tips follow one form grammar.
- Destructive navigation with unsaved changes requires confirmation.

### Planner

- Preserve the current weekly mental model.
- Strengthen date hierarchy, today state, empty slots, filled slots, drag targets, and recipe-picker states.
- Photography is subordinate to schedule scan speed.
- Web retains efficient drag-and-drop plus accessible non-drag alternatives.
- iOS uses native selection sheets and direct slot actions.

### Shopping

- The grocery checklist is the primary surface.
- Planned-meal context, list preparation, smart refinement, checked/already-have items, and store suggestions are visually distinct layers.
- Core list use never depends on store-product scraping being available.
- Product suggestions display loading, cached, refreshing, partial success, unavailable, stale, and retry states.
- A scraper failure affects only its product-suggestion region, not the grocery item or the rest of the list.

### Settings and admin

- Settings use the same section, form, and confirmation components as the rest of the app.
- Account, library sharing, language, privacy, future account deletion, and future subscription management have clear homes.
- Admin tools are visually and navigationally separated from normal user workflows.

## Data and Interaction States

### Loading

- Skeletons preserve layout for page content and lists.
- Spinners are reserved for compact actions whose bounds are already stable.
- Initial loading, background refresh, and single-action loading are visually different.

### Empty

- Empty states explain why the surface is empty and offer one relevant next action.
- They do not impersonate errors.

### Errors and retries

- Local failures remain local. A failed image, catalog request, or product lookup does not replace the entire page when other content still works.
- Retry actions are attached to the failed region.
- Error copy states what happened in user language and avoids exposing raw backend responses.

### Partial and stale results

- Previously cached product results remain visible during refresh when safe.
- Stale data receives a quiet timestamp/status label.
- Empty cached results are not treated as permanent proof that a product is unavailable.
- These UI states prepare for, but do not implement, the separate scraper reliability design.

### Optimistic interaction

- Optimistic updates are allowed only when reversal is reliable and visible.
- Destructive operations, recipe saves with complex validation, and purchases are confirmed by the server before final success presentation.

## Responsive and Localization Requirements

- Web layouts are explicitly designed for phone, tablet, laptop, and wide desktop—not merely allowed to wrap.
- Chinese and English receive equal verification.
- Layouts tolerate longer translated labels without truncating primary actions.
- CJK text uses appropriate system fallbacks and line-height rather than forcing Latin metrics.
- Masonry column count responds to usable content width and accessibility text size.

## Accessibility Requirements

- Web targets WCAG 2.2 AA contrast and interaction behavior.
- All web controls are keyboard operable and expose visible focus.
- iOS supports VoiceOver, Dynamic Type, safe areas, and minimum 44-point touch targets.
- Color is never the only indicator of selection, status, or error.
- Motion respects reduced-motion settings.
- Images have meaningful alternative text when they convey recipe identity; decorative duplicates are hidden from assistive technology.

## Verification Strategy

Each vertical slice must include:

- Component-state tests for affected primitives.
- Web interaction tests for keyboard and pointer behavior.
- Web visual-regression screenshots at phone, tablet, and desktop sizes.
- iOS component/interaction tests and simulator walkthroughs.
- English and Chinese screenshots.
- Loading, empty, partial-error, full-error, retry, offline, and large-data fixtures.
- Accessibility checks covering focus order, labels, contrast, Dynamic Type, and touch targets.
- Existing feature-flow verification so the redesign does not silently change business behavior.

## Rollout Plan

### Cycle 1: Foundation and shell

- Create the token source and platform adapters.
- Create core primitives and their state examples.
- Replace web and iOS application shells, navigation, account access, and global Add Recipe actions.
- Establish visual-regression and accessibility checks in CI.

### Cycle 2: Library and recipe workflow

- Redesign personal/public/shared libraries with natural masonry.
- Redesign recipe detail.
- Redesign import and recipe editing using shared form primitives.

### Cycle 3: Planner

- Redesign web week layout, drag/drop, accessible selection, and responsive states.
- Redesign iOS week cards, slot actions, and recipe picker.

### Cycle 4: Shopping

- Redesign the core checklist and planned-meal context.
- Redesign smart-list preparation and already-have states.
- Add complete product-result state components without changing scraper behavior.

### Cycle 5: Finishing

- Redesign authentication, settings, and admin surfaces.
- Complete localization and accessibility audits.
- Remove obsolete CSS, inline page styling, duplicate page files, and superseded components.
- Perform staging regression review before production promotion.

Each cycle updates web and iOS together and is reviewed on staging. The old and new systems may coexist temporarily behind migrated routes/components, but a single screen must not mix unrelated visual systems.

## Success Criteria

The redesign is successful when:

1. A user recognizes web and iOS as the same product without either feeling like a port of the other.
2. Library images remain complete at their original aspect ratios.
3. Library, Planner, and Shopping are the only primary destinations; Add Recipe is globally available in one visible place at a time.
4. Existing import, library, planning, and shopping workflows continue to function.
5. All production screens use semantic tokens and approved primitives instead of raw page-specific visual values, except documented content-specific cases.
6. Important loading, empty, error, retry, offline, partial, and stale states are implemented and tested.
7. Web passes the agreed WCAG AA checks and iOS passes the agreed VoiceOver, Dynamic Type, and touch-target review.
8. Obsolete overlapping styling is removed after the final migration cycle.

## Follow-on: Scraping Reliability

After the UI redesign plan is approved and underway, scraping receives its own design and implementation plan. That project will cover product-name normalization, successful fetch rate, latency, cache semantics, negative-cache behavior, retries, stale-while-refresh behavior, match confidence, observability, and store-specific failure handling. It will integrate with the shopping states defined here without expanding this redesign's backend scope.
