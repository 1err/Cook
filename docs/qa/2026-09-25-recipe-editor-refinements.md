# Recipe editor refinements — local verification

Status: implemented and verified locally; not deployed. The recorded API19/web production
release is unchanged. No credentials, migrations, live recipes, or provider calls were changed
by these checks.

## Result

- Shared step cards use scoped CSS, consistent control groups, and a separate header for
  reorder/delete actions. The focused tutorial editor has a cooking summary and responsive
  desktop/phone layouts. Existing illustration choices and assets are unchanged.
- Detail tutorials omit instruction-authorship badges and label validated moment links
  "Source". Suggested-step cautions remain in editors.
- Ingredient detail rows show only the ingredient name and one primary source amount, without
  preparation-note subtitles. Notes remain available when editing, and an expandable section
  preserves all original text and alternate measurements. Import review
  keeps notes and optional grams/mL equivalents behind per-ingredient disclosures. Extraction
  preserves source units and labels necessary estimates as approximate.
- Cover uploads are available during import/manual creation, full editing, and directly on
  saved detail. Upload/save errors retain the previous cover. Pending uploads block saving.
- Import tags are visible and selectable by category. Applying contextual extraction preserves
  the latest cover and tags, including changes made after the candidate was prepared.
- Step-image upload completion merges by stable step identity into current state, preserving
  intervening edits/reordering. Errors are retryable; removed/unmounted targets are ignored.

## Automated checks

- `npm run test:web`: 70 files, **589 tests passed**.
- `npm run test:shared`: **73 shared + 36 API-client tests passed**.
- Web TypeScript check: passed.
- `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8871 npm run web:build`: passed, including type checking
  and all 29 static pages. The local API base is deliberately for the sample preview only.
- Backend targeted tests: `tests/test_extract_ingredient_quantities.py`,
  `tests/test_extract_tutorial.py`, and `tests/test_video_analysis.py`: **144 passed**.
- `git diff --check`: passed.

## Browser checks

Used the in-app browser against the local build at desktop 1280×720 and phone 390×844.
The preview injects a persistent **UI PREVIEW · Sample data and source links · Video links
are not analyzed here** banner. Its in-memory recipe/upload API and reverse proxy live only
in `/private/tmp/recipe-polish-preview`, outside the repository.

- Tutorial cards and metadata fit both viewports without horizontal overflow.
- Reordered a step and changed its duration, saved, and observed both changes on detail.
- Inspected full-editor cards, concise ingredient rows, and source-link placement.
- Prepared a sample import draft, selected a tag, and expanded optional quantity details.
- No application console warnings/errors during these checks.
- Cover upload success/failure and step-image race handling are covered by automated tests;
  they were not tested against production image storage in the browser.

## Release boundary

This preview proves UI behavior with example data; it does not prove a new live video
extraction. Before publishing, rebuild the website with the production API base, then use
the existing frontend/backend release checks. Never deploy the preview's local build or
temporary fixture services.
