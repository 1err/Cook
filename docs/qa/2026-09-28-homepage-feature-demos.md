# Homepage feature previews — 2026-09-28

## Scope and source

The approved homepage design replaces the mapo-tofu hero with a real recipe-library screenshot and an actual generated-menu image. Six accessible feature tabs cover Recipes, Menu maker, Planner, Shopping, Muse, and Cook. Each uses real supplied imagery and concise English/Chinese benefit copy. The screenshot can be enlarged; a silent 30-second landscape feature-preview montage plays only after a user action and has native controls plus a text alternative.

Implementation is isolated in `/Users/xiang1err_/.codex/worktrees/chef-world-homepage-demos/Cooking` on `codex/homepage-feature-demos`, based on `a947e99027fabcddd644ea3750e92117883111f4`. The user approved integration of the standalone design before product changes. The original dirty checkout and previous release worktree were not edited.

Homepage language is page-local and defaults to English. Switching it translates its header/footer but does not overwrite the saved app language. Other public pages retain their English defaults. Public access, authentication redirects, existing destinations, and product features are unchanged. Prototype-only editable copy controls were removed. There are no dependency, backend, API, migration, or production configuration changes.

## Media

The supplied screenshots and menu originated in `outputs/rednote-launch-2026-09-27/raw/`; the homepage montage came from `outputs/rednote-launch-2026-09-27/homepage-preview.mp4`. Seven WebP images and the MP4 are shipped under `apps/web/public/brand/features/`, totaling 2,507,872 bytes. The MP4 is 1,660,626 bytes, H.264, 1920 × 1080, 30 seconds, with no audio track. It uses `preload="none"`, a poster, and no autoplay. The menu tab uses the clean generated-menu image, not the rejected full-page menu capture.

This is a feature preview made from actual screens; it does not represent a continuous recording of app operations or prove an external shopping-cart action. Muse copy retains explicit review/copy/paste and user checkout boundaries. No free-membership promise or new retailer-access claim is introduced on the public homepage.

## Automated verification

Baseline before implementation:

```sh
npm --workspace @cooking/web test -- app/lib/i18n.test.tsx app/components/Header.test.tsx app/components/AuthShell.test.tsx
```

Result: 18 tests passed across three files.

Final checks after the review corrections:

```sh
npx tsc -p apps/web/tsconfig.json --noEmit
npm --workspace @cooking/web test -- app/public-site/HomePage.test.tsx app/lib/i18n.test.tsx app/components/Header.test.tsx app/components/AuthShell.test.tsx
NEXT_PUBLIC_API_BASE=https://api.chef-world.com NEXT_PUBLIC_ENABLE_LOCAL_EMAIL_PREVIEW=false npm run web:build
git diff --check
```

Results: TypeScript passed; 21 tests passed across four files; production build passed, generated 29 static pages, and reported the homepage at 8.28 kB / 115 kB first-load JavaScript; whitespace check passed. The development server was stopped during the final build to avoid shared `.next` writes. Existing installed dependencies were reused through ignored local symlinks; no install or lockfile change was made.

Three focused behavior checks cover homepage/app language isolation, keyboard tab navigation with correct screenshot enlargement, and click-only video playback with useful failure handling. After correcting a jsdom native-dialog stub, these checks failed against the old homepage for the missing behaviors and passed with the implementation. Existing public-page E2E expectations were updated for the approved feature tabs and language control; the Playwright browser suite was not executed in this task. Browser verification used CUA instead.

## Rendered verification

The coordinating agent verified the local app through CUA after integration:

- 1280px desktop and 750px tablet layouts passed.
- At 690px, the corrected header used a separate navigation row; document scroll width was 690px, with no horizontal overflow.
- At 390px in Chinese, document scroll width was 390px. Copy and media remained contained.
- Menu enlargement displayed the correct portrait image. Escape closed the dialog and restored focus to the enlargement button.
- ArrowRight selected Planner from the preceding tab. Muse and Cook showed their corresponding screenshots and truthful feature copy.
- The landscape video reported a 30-second duration and 1920 × 1080 dimensions; playback reached about 17 seconds without a media error.

The earlier approved standalone prototype had also been checked at desktop and 390px: language switching, all feature tabs, screenshot enlargement, loaded images, and horizontal containment passed.

## Review corrections

- Replaced a flawed full-page menu capture, which contained blank space and duplicated partial imagery, with the actual clean menu image; removed the unused screenshot asset.
- Set an explicit light color for the partnership link, its hover state, and focus outline to remain readable on the sage background despite global anchor styles.
- Scoped the header wrap at 760px to the homepage's language-enabled header, fixing the observed 690px overflow without altering other public-page headers.
- Kept the Chinese hero at a maximum 56px with sensible word wrapping.
- Updated the stale English-only homepage description in `CLAUDE.md`.

## Delivery boundary

This record covers local source, build, focused tests, and CUA checks. No push, deployment, backend release, database mutation, or retailer transaction was performed. The local review server runs at `http://127.0.0.1:3014`.
