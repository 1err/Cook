# Homepage preview refinement — September 28, 2026

Scope: preserve the approved public-homepage design and shopping behavior, add bounded scroll/click demonstrations, refresh the post-ready launch kit, and deploy the website as authorized in the user's follow-up. No backend or native release is needed.

- Feature order is Recipes, Planner, Shopping, Muse, Menu maker, Cook.
- Recipes/Planner/Shopping use actual taller screen captures in native focusable scroll regions. Enlargement opens the same capture with an independently scrollable dialog.
- Cook advances through three real captured states using a small Complete & next step control, then offers Replay. These are three sampled states of a fourteen-step recipe, labeled Preview 1/3 through 3/3. No homepage interaction calls a private API or changes an account.
- A failed cooking-sequence asset falls back to a clearly labeled static screenshot and hides sequence controls. The existing silent 30-second video remains click-to-play with a text alternative.
- Prior shopping sorting, original selection indices, cleaned presentation labels and compact single-line choices remain intact. The new actual plan introduced `weee_dairy_`; this exact prefix was added to the existing presentation-only allowlist. Raw identity, source names, URLs and quantity parsing remain unchanged.

## Captures and provenance

The user added nine dishes to September 28–October 4, across Monday through Wednesday. Production UI captures include the full saved 豆腐茄子煲 recipe, that updated weekly plan, and Cook states 1 → 2 → 3. The prior demonstration cooking session was advanced twice to record those states; no dish or session was marked fully cooked. No recipe or planner entries were edited by this task.

The smart list was prepared through the signed-in production UI for this week (64 items); 192 actual visible product choices and all nine planned meals were read from the DOM. Shopping/Muse captures render the revised local production components using these observations in a loopback-only fixture. They do not claim a live deployment, retailer cart mutation or checkout. Existing retailer matching can return unsuitable suggestions; the UI retains review and user selection, and no purchasing was performed.

Long screenshots were composed from overlapping normal viewport captures, preserving source pixels and avoiding repeated sticky navigation. The shopping excerpt ends after the first complete produce row. Raw captures and private observations are in the local launch output folder; private fixture data and QA files are excluded from the consumer ZIP.

## Verification before deployment

- Final focused web suite: 81 passed across HomePage, ProductPicks, page.productLookup, MuseShoppingDialog and CartAssistantDialog.
- Shared store/Muse suite after the dairy-prefix addition: 102 passed, including raw-name, URL, identity and signature preservation.
- Web TypeScript passed; production build passed and generated 29 static pages. Homepage: 9.16 kB route, 116 kB first load JS.
- Independent review found one misleading Cook-image failure path; fixed and covered by a regression test before build.
- CUA desktop: all three scroll regions load their actual captures and respond to PageDown; tab switching restores initial scroll; keyboard wrapping works; tall screenshot enlargement scrolls; Escape closes; Cook renders distinct states 1/2/3 and Replay resets.
- CUA 390px: Chinese shopping preview scrolls, Cook advances to Preview 2/3, and document width remains 390px (no horizontal page overflow).
- Local shopping render: Meat & Seafood, Produce, Pantry & Dry Goods, Dairy, Other order; three choices per ingredient; selection text has nowrap and a one-line 18.59px height.
- Final landscape video: H.264, silent, 1920×1080, 30 seconds; SHA256 f6c5cc873e4c592124dc6f4a96354da53d95a956e283564fdc0506ef5dfc2bf4. Real Cook state changes appear in its final scene.

## Release baseline

Before release, Vercel reports chef-world.com as READY deployment dpl_ERWE8GmFYpZXVhLYerZVmTBYCQhZ, source 6a3d88f per its checked-in release record. This branch descends from that source and the prior homepage/shopping refinement commit 1a8c0ea. The original working directory is untouched. Candidate source and deployment receipts will be recorded separately in /private/tmp/chef-homepage-release-20260928.

## Published release and final checks

- Application source: `b8519da429cbae401f2d4acbd62c307e638c7407` on `codex/homepage-feature-demos`.
- Frozen allowlisted Vercel upload: 280 files, 28,309,262 bytes; dry-run paths, SHA1 values and byte sizes exactly matched the source manifest. No private captures, fixtures, environment files or launch QA were uploaded.
- Deployment: `dpl_Cg8Q4JckAjAVc7ovLjvpQcTgTDGp`, `https://cook-7av7mpkpp-jerrys-projects-08f739a2.vercel.app`.
- Candidate built successfully; 41 route/asset checks passed, including exact SHA256 matches for all 14 feature assets. Candidate protection stayed enabled and authenticated Vercel curl was used for these checks.
- Promoted only after confirming the original live deployment was unchanged. Both `chef-world.com` and `www.chef-world.com` resolve to the new deployment. Public live checks passed for 42 routes/assets, with exact feature-media byte matches.
- Live CUA: Recipes, Planner and Shopping captures loaded at natural width 1280 and scrolled inside their frames. Cook rendered distinct states 1/2/3, Replay restored state 1, and the click-to-play video loaded all 30 seconds and played. Feature order matches the requested workflow.
- Live Chinese mobile: 390px document width at a 390px viewport, no horizontal overflow; the next-step control reached Preview 2/3 and its image loaded. Temporary viewport overrides were reset.
- Signed-in production UI confirmed nine planned recipes and 64 smart-list items. Its actual category order is Meat & Seafood, Produce, Pantry & Dry Goods, Dairy, Other. All 192 loaded product choices showed no internal `weee_` prefix; all 192 selection labels used nowrap and a one-line 18.59px text height. Direct Weee links remain available. No retailer cart, Muse submission or checkout was performed.
- No Chef World page errors appeared in the captured browser console. The new Vercel deployment's bounded 15-minute error-level log query returned no entries. This is a release-window check, not a long-term reliability claim.
- Final post-ready ZIP: `outputs/chef-world-rednote-launch-ready.zip` in the original repository, 17 consumer files, 14,008,741 bytes. ZIP CRC and all member SHA256/size checks passed against the publication manifest. ZIP SHA256: `83b055ef601e0bbc8477a39b714d5dabe06416c5f10ea0240c3fee3b6bcb773a`.
- Final portrait video: 30 seconds, 1080×1920, H.264, silent; SHA256 `a974afebd2ed59918caad39bd382dc43b0ccea032bf6a92f3cd91388abaf5adf`. The Chinese copy confirms joining beta now qualifies for one year from membership launch, with feedback optional and grocery/third-party costs separate. No Rednote post was published.

Deployment receipts remain in `/private/tmp/chef-homepage-release-20260928`; local visual evidence and packaging receipts are in the launch output's `qa/` folder and excluded from the consumer ZIP.

## Follow-up: poster framing and shopping motion

The user's screenshot review requested slightly more space around framed captures, a shorter import form and more ingredients/steps in poster 02, complete product photos/cards in poster 04, and visible shopping scroll motion in the videos. The six framed posters now use a consistent 24px inset around genuine screenshot sections; the standalone menu artwork and approved copy are unchanged. Poster 02 retains the link field/tabs while excluding the helper paragraph and shows eight ingredients plus four complete steps. Poster 04 uses one contiguous real capture with the header and six complete first-row product choices including Weee links. Independent visual review found no remaining framing issue.

Both 30-second videos now pan smoothly through the genuine shopping long screenshot, within a stationary frame. The portrait video matches the updated poster inset; the landscape video's existing Cook 1/2/3 sequence remains intact. Encoded beginning/middle/end shopping frames and Cook frames were visually reviewed. No cursor, cart action or live-processing speed is fabricated. Homepage video SHA256: `1e7d6128af606e7712fc91c2f71cfbff1381ee69951b4b651bdcde056d4c55b6` (2,170,047 bytes). Portrait video SHA256: `283bebdc21415633e9b932bb25be68dd565d34e55c454d7cb1695d9c48504fb6` (2,211,521 bytes). Both are H.264, 30fps, 30 seconds, without audio.

Only the homepage MP4 changes in application source for this follow-up; shopping behavior, homepage interactions, and recipe data are unchanged. Release verification for the updated asset is recorded below when complete.


Follow-up release: application source `e51819c21b9478d09c3450590465aa8cd5c61b19`; Vercel deployment `dpl_HULRZGx1oz4SqYSSgJcH5Rranso4` (`cook-o6bf7l7x1-jerrys-projects-08f739a2.vercel.app`). Upload verification matched 280 allowlisted files (28,562,097 bytes) and confirmed that the MP4 was the only changed uploaded file. Remote production build succeeded. Candidate checks: 41 routes/assets, all 14 media files matched exact source bytes. Promotion occurred after rechecking the live predecessor. Both production domains now point to the new deployment; 42 public live routes/assets passed with exact media hashes. CUA played the hosted 30-second MP4 through to completion with readyState 4 and no media error; no Chef World console error was captured. The bounded ten-minute deployment error-log query returned no entries.

The updated 17-file launch ZIP is available as both `chef-world-rednote-launch-ready.zip` and `chef-world-rednote-launch-kit-v2.zip`, 13,736,922 bytes, SHA256 `238d49ffe535259d1eb3aef4437531146377c7158a00ab3d4f268ab256f67e9d`. CRC passed and every entry exactly matches the current consumer files. Both final MP4s decoded in full without ffmpeg errors. No application logic changed; the earlier application tests remain the baseline. Release receipts: `/private/tmp/chef-homepage-motion-release-20260928`.


## Follow-up: original planner, menu creation, and Cook video

The user identified duplication in the stitched Planner sidebar and requested the single original screenshot. Planner now uses `07-planner.webp` in both its static preview and enlargement; it has no scroll hint or tall image. Recipes and Shopping retain their scroll viewports. Menu maker now shows an actual menu-creation screenshot with the user's finished artwork layered at the bottom right, matching the approved hero treatment. Its PNG composite was rendered with CUA from source screenshots; no interface text or artwork was regenerated. The wide 30-second tour uses this same composite in its menu scene. Existing poster PNGs, Chinese post copy and portrait video remain unchanged.

Cook's manual screenshot-step controls were removed. A nine-second click-to-play video provides subtle vertical movement and the real captured step 1/2/3 transitions, with native controls, replay and no autoplay. Tab exit pauses and unmounts the video; returning starts from its poster. Failed playback shows an explicitly described static screenshot. English/Chinese labels are supported and the separate 30-second tour remains available. No cooking API or account state is changed by the preview.

Local verification: eight focused homepage tests and TypeScript passed, including retained tab order/scrolling, static Planner/Menu enlargement, no autoplay, play/replay, tab-unmount cleanup, bilingual copy, no private API calls and an honest failure fallback. Independent source review found no actionable issue. CUA confirmed original Planner/enlargement source, menu composition, nine-second video playback and replay, unmounted video after changing tabs, and Chinese mobile playback at 390px without horizontal overflow. Both new video and updated wide tour decode fully without ffmpeg errors. Cook MP4: H.264, 1920×1080, 30fps, nine seconds, silent, 766,651 bytes; SHA256 `6066bef1eef3c2f97266fba11490b7fa65bc6bd92e52b6f2da58853961049fe1`. Updated wide tour SHA256: `d906fe1315f27388994093277a7e097390c5d0f1252ecd0b91ca3ad5e387a5db`.

Launch-kit v3 contains the previous 17 consumer files plus the standalone Cook video and menu composite. ZIP integrity and all 19 entries match the refreshed manifest. Its size is 14,428,625 bytes and SHA256 `2fc76b377df39b71e54765281112e78f32a2e88d1b89cf7d40340277ccd7a661`.
