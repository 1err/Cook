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
