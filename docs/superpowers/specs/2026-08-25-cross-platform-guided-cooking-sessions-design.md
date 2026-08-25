# Cross-Platform Guided Cooking Sessions

**Date:** 2026-08-25

**Status:** Approved in product/design review; written specification pending final review

**Platforms:** Web and native mobile

**Depends on:** the existing recipe tutorial flow and the approved Culinary
Workbench UI reset in
docs/superpowers/specs/2026-08-25-chef-world-cross-platform-ui-reset-design.md.

**Supersedes:** the UI reset's three-tab mobile decision only. Cook becomes a
fourth destination; Library remains the authenticated landing destination.

## Product Decision

Chef World adds a Cook destination that turns saved tutorials into
account-synchronized cooking sessions. Users start from a planned meal or choose
library recipes, work through one current step per dish, run countdowns for
passive steps, and see time-weighted progress across several dishes.

V1 is an attention-aware workspace, not an automatic scheduler. It keeps every
dish and timer visible and tells the cook what needs attention. Its contracts
allow a reliable schedule engine and paid AI assistant to be added later.

## Goals

1. Add Cook consistently on web and mobile while keeping Library as the default.
2. Allow one active account session containing multiple recipes.
3. Start from planned meals, library selection, or recipe detail.
4. Generate duration, attention type, and an action illustration for each step.
5. Keep generated metadata editable during import and from recipe detail.
6. Use explicit completion and countdowns only for passive steps.
7. Calculate transparent time-weighted progress.
8. Synchronize through REST and survive brief connectivity loss.
9. Establish a stable recommendation contract for future scheduling and AI.

## V1 Non-Goals

- Concurrent active steps inside one dish.
- Automatic cross-dish schedules or a claimed meal finish time.
- Live AI advice, cooking history, or voice control.
- Guaranteed Web Push after a browser is fully closed.
- Automatic step photography or video-frame extraction.
- New step-image authoring. Existing images remain preserved and render.

## Navigation and Entry

Web and mobile primary order is Library, Planner, Cook, Shopping. Login still
lands on Library. Web uses /cook; mobile adds CookStack under the Cook tab.

With no session, Cook offers:

- **Planned meals:** choose date and Breakfast, Lunch, or Dinner. Existing slot
  recipes are preselected for confirmation.
- **Choose recipes:** search and select any owned library recipes.

Recipe detail exposes **Start cooking**, **Add to current session**, or **Open in
Cook**, depending on session state. A recipe without usable steps opens **Edit
tutorial** instead.

An account has at most one active session. Starting another returns a conflict
with Resume and Discard choices. Removing the last dish discards after
confirmation. Structural changes require connectivity.

## Active Cooking Experience

Every platform shows per-dish progress, one current step per dish, all passive
timers, one focused dish, a Next attention summary, and add/finish/discard
controls. Focus is device-local; focusing rice on mobile does not change web.

### Desktop and tablet

Use the approved **Focus + dish rail**:

- A large main pane presents the focused dish and current step.
- A compact rail keeps every other title, progress, current step, timer, and
  attention state visible.
- Selecting a rail item changes focus.
- Stable dish order prevents cards jumping; badges communicate priority.

### Phone

Use the approved top dish switcher, one focused step below it, and a persistent
bottom tray for running or expired timers. Full titles and statuses remain
available to assistive technology when visual labels truncate.

### Step presentation

Show dish title, step position, percentage, instruction, duration provenance,
hands-on/passive type, and relevant controls. A real existing image takes
precedence; otherwise show one custom cross-platform action illustration.

Production uses matched vector assets, not emoji. Semantic actions are prep,
chop, mix, season, sear, simmer, boil, bake, rest, drain, assemble, plate, and
other.

## Step Interaction Model

Hands-on steps display estimated time but no timer. Their primary action is
**Complete step**.

Passive steps display **Start timer**. The focused timer uses the approved calm
progress ring with large tabular digits; rails and the phone tray use compact
timers. Controls are Pause, Resume, Add one minute, and View step.

Expiry sets **Needs attention** and triggers permitted alerts. It never
auto-completes. The user checks the food and explicitly completes the step.

Completing or skipping resolves the current step, advances the earliest
unresolved step, and briefly offers Undo. Skipped steps count as resolved but
remain visually distinct.

Earlier steps stay reviewable. Reopening is allowed only when that dish has no
running, paused, or needs-attention timer. It makes the reopened step current and
locks the previously ready step.

The final resolved step marks a dish Done. When every dish is Done, **Finish
cooking** deletes the session. V1 retains no history.

## Recipe Tutorial Metadata

RecipeStep expands to:

    id: string
    text: string
    duration_seconds: integer | null
    duration_source: stated | estimated | user | fallback
    attention_type: hands_on | passive
    action_type: supported action enum
    image_url: string | null

New fields remain backward-compatible at API boundaries. IDs are UUID strings.
An Alembic data migration adds IDs to legacy JSON-in-Text steps. Canonical
coercion also supplies IDs for later legacy writes. Reordering preserves IDs;
adding or duplicating generates new ones.

### Import extraction

Transcript and YouTube-caption extraction must:

1. Preserve source-stated durations and label them stated.
2. Estimate a reasonable positive duration when absent and label it estimated.
3. Classify every step as hands_on or passive.
4. Select one supported action_type.
5. Continue refusing to invent unsupported instructions.

Invalid metadata does not fail import. The parser applies a fallback and labels
it fallback. If the source states total time, total_time_minutes preserves it;
otherwise it is the rounded-up sum of normalized step durations.

Generated durations normalize to whole seconds between 15 seconds and 24 hours.
User-edited durations may be any whole number of seconds from 1 through 86,400.

### Legacy fallback

Keep valid durations. If recipe total time exists, distribute positive remaining
time across missing steps with a 60-second minimum. Otherwise use the median
known duration; when none exists use 300 seconds. Label these fallback and
default them to hands_on and other.

Edit tutorial offers **Estimate missing tutorial details** for one-time LLM
enrichment. Starting Cook never silently rewrites a recipe.

### Editing and read view

AI output is never locked. Import review and recipe detail's **Edit tutorial**
mode let users add, remove, reorder, and edit text, duration, attention type, and
action illustration. Editing duration sets its source to user. Existing image
URLs are preserved. Save returns to detail; cancel preserves the old recipe.

Active sessions own snapshots, so recipe edits affect only future sessions.
Recipe detail displays transparent labels such as:

    About 8 min · AI estimated · Passive

## Progress Calculation

    sum(duration for completed or skipped steps)
    --------------------------------------------- × 100
    sum(duration for all dish steps)

Running, paused, ready, locked, and needs-attention steps contribute no completed
weight. Timer rings move continuously, but dish percentage changes only after
resolution. Reopening subtracts weight. Percentages round to whole numbers; Done
is exactly 100%. V1 shows per-dish percentages, not a meal finish estimate.

## Persistence Model

Session state is normalized so independent step changes do not overwrite a whole
JSON document.

### cooking_sessions

- UUID primary key.
- Unique user_id foreign key, enforcing one active session.
- Integer version.
- created_at and updated_at.

V1 deletes the row and children on finish or discard.

### cooking_session_dishes

- UUID primary key and cascading session_id.
- recipe_id provenance and integer position.
- Snapshots of title, thumbnail, ingredients, equipment, and tips.
- created_at.

Deleting or editing the source recipe after session start does not alter the
snapshot.

### cooking_session_steps

- UUID primary key and cascading dish_id.
- recipe_step_id snapshot reference and integer position.
- Snapshot of text, duration, source, attention type, action type, and image.
- State: locked, ready, timer_running, timer_paused, needs_attention, completed,
  or skipped.
- timer_started_at, timer_ends_at, paused_remaining_seconds, and resolved_at.
- notification_owner_device_id while a system alert is assigned.
- Integer revision and updated_at.

Only one unresolved step per dish may be non-locked. A transactional repository
transition function enforces the state machine.

When a dish snapshot is created, its first step is ready and later steps are
locked. A running timer whose end timestamp has passed is treated immediately as
needs_attention by clients; the next authenticated read or mutation persists
that normalized state transactionally.

### Idempotent mutations

A cooking_session_mutations table records mutation UUID, session ID, device ID,
and applied time. Unique mutation IDs make retry and offline replay safe. Records
are removed with the session.

## API Surface

All routes require authentication and scope by user_id.

| Method | Path | Purpose |
|---|---|---|
| GET | /cooking-session/active | Active session or null |
| POST | /cooking-session | Create from recipe_ids; 409 if active |
| POST | /cooking-session/{id}/dishes | Add owned recipes |
| DELETE | /cooking-session/{id}/dishes/{dish_id} | Remove a dish |
| POST | /cooking-session/{id}/steps/{step_id}/actions | Apply a transition |
| POST | /cooking-session/{id}/finish | Finish and delete an all-done session |
| DELETE | /cooking-session/{id} | Discard and delete |

Step-action payloads contain action, optional extension seconds, mutation ID,
device ID, client occurrence time, and expected revision. Supported actions are
start_timer, pause_timer, resume_timer, extend_timer, complete, skip, and reopen.

Invalid transitions return 409 with stable reason codes. Ownership misses return
404 rather than disclosing another user's session.

## Synchronization and Offline Behavior

V1 introduces no WebSocket. Clients fetch when Cook opens or regains focus, poll
every five seconds while Cook is visible, update optimistically, and replace
optimistic state with the canonical response. Countdown displays derive from
absolute timer_ends_at and observed server/client clock offset.

Web uses a user-scoped localStorage cache. Mobile uses the existing persistent
storage abstraction with a new user-scoped prefix. Logout removes cached session
data, queued changes, local device ownership, and scheduled notifications. The
server session remains resumable by the original user after sign-in.

Step actions may queue during brief offline periods. Structural actions require
connectivity. Queued actions carry mutation ID, expected revision, and occurrence
time and replay in order. Duplicate IDs succeed idempotently. Incompatible stale
transitions return 409, reload canonical state, and show a concise conflict
notice instead of silently overwriting another device.

## Timer Ownership and Notifications

Every client has a random, user-scoped local device ID. Starting or resuming a
timer makes that device its alert owner:

- The owner schedules the system-level alert.
- Other open devices show synchronized state without duplicate system alarms.
- Another device can explicitly **Take over alerts**.

Mobile schedules a local notification from the absolute end timestamp, surviving
normal backgrounding and closure. Permission denial does not block timers.

Web uses Notifications API, audio, and visibility-aware recalculation while the
browser remains alive. It explains that the browser must remain open for a
reliable alarm and may offer transfer to mobile. Closed-browser Web Push is
deferred.

Expiry sets Needs attention everywhere; no device completes the step. Sound,
vibration, and notification preferences are independently mutable.

## Recommendation Foundation

V1 uses a pure provider in @cooking/shared so both clients share deterministic
logic. Its output contains:

    id
    kind: attention | timer | ready
    priority
    dish_id
    step_id?
    message_key
    message_params
    reason_code
    due_at?

It prioritizes running timers whose end timestamp has passed but has not yet been
server-normalized, other needs-attention steps, running timers by soonest expiry,
and ready hands-on steps in dish order. Messages use localization keys and may
say:

    Check Mapo tofu now. Rice finishes in 8 minutes.

It does not infer overlapping steps inside one dish or a meal finish time. A
future schedule engine or paid AI assistant can return the same contract.

## UI System Integration

Cook consumes the Culinary Workbench system: warm ivory canvas, white surfaces,
dark brown-black text, oxblood actions, olive statuses, restrained borders,
Source Serif 4 for dish titles, and Inter/platform sans for instructions and
controls.

It reuses the UI reset's final shell, buttons, statuses, tabs, selection,
empty/error, and dialog/sheet primitives. It must not create a parallel token set
or add route-specific rules to the monolithic global stylesheet.

UI-reset work is active in another task. Backend recipe/session work may proceed
independently, but Cook UI must wait for or rebase onto stabilized shared shell
and component foundations to avoid conflicting edits.

## Error and Empty States

- Empty session: planned/manual selection.
- Empty planned slot: **Choose recipes instead**.
- Recipe without steps: **Edit tutorial**.
- Invalid generated timing: preserve draft, label fallback, allow correction.
- Existing active session: 409 with Resume/Discard.
- Removing a progressed dish or active timer: named confirmation.
- Notification denial: inline limitation notice.
- Offline: cached content remains readable and queued actions are marked.
- Conflict: reload canonical state and explain the rejected action.
- Broken image: use the action illustration.
- Deleted recipe: continue from the session snapshot.
- Finish before all dishes are done: 409 and focus unresolved dishes.

Errors remain local whenever the workspace is still usable.

## Accessibility, Localization, and Kitchen Ergonomics

- WCAG 2.2 AA web contrast and visible focus.
- Minimum 44px/44pt targets.
- Dish-specific accessible timer labels.
- Announce timer start, pause, resume, and expiry, not every second.
- Never communicate state through color or sound alone.
- Reduced-motion support.
- Keyboard and assistive dish switching; swipe is never the only path.
- Safe-area-aware phone tray and Dynamic Type support.
- English and Chinese verification across phone, tablet, laptop, and desktop.
- CJK-aware instructional line height.
- Request screen-wake behavior during a session, with a user-controlled toggle.

## Security and Privacy

- Every query is authenticated and user-scoped.
- Only owned library recipes may enter a session; public/friend recipes must
  first be copied.
- Device IDs are random local identifiers, not hardware fingerprints.
- Notification previews follow platform permission and privacy settings.
- Future AI assistance requires a separate consent and data-flow design.

## Verification Strategy

### Backend and shared

- Step metadata migration and legacy backfill.
- Prompt/parser fixtures for stated/estimated timing, attention type, action
  type, CJK, malformed output, and no invented instructions.
- One-session constraint and ownership isolation.
- Every valid and invalid state transition.
- Idempotency, revision conflicts, offline replay, snapshots, and cascades.
- Fake-clock expiry and timestamp behavior.
- Progress, skip, reopen, rounding, and recommendation ordering.

### Web

- Library remains the authenticated landing route.
- Empty Cook, planned/manual selection, resume, and conflict handling.
- Focus + rail plus narrow-width phone-switcher behavior.
- Full hands-on/passive lifecycle, Undo, skip, reopen, remove, finish, discard.
- Polling, focus refresh, optimistic rollback, offline queue, and conflict UI.
- Notification permission and browser-alive limitation.
- Keyboard, reduced motion, live regions, localization, and no overflow.

### Native mobile

- Four tabs with Library initial.
- Planned/manual selection and recipe-detail entry.
- Phone switcher, timer tray, safe areas, and Dynamic Type.
- Local notification scheduling/cancellation, backgrounding, restart, and alert
  ownership transfer.
- Logout cache clearing and cross-user isolation.
- VoiceOver and touch target verification.

### Cross-device

- Start on web and resume on mobile.
- Start a mobile timer and observe web countdown/expiry.
- Complete different dishes concurrently without state loss.
- Replay an offline change after another device advances the same dish.
- Transfer timer-alert ownership.
- Edit a saved recipe during a session without changing its snapshot.

## Implementation Decomposition

This umbrella feature has four separately planned and verified sub-projects.

### A. Tutorial timing foundation

- RecipeStep expansion and migration.
- Import prompt/parser.
- Legacy fallback and enrichment.
- Import review and recipe-detail editing.
- Detail metadata and pictograms.

### B. Cooking-session domain

- Database models and migration.
- Transactional state machine.
- REST API and API-client.
- Shared progress and recommendation contracts.

### C. Cross-platform Cook UI

- Web route and primary link.
- Mobile Cook stack and fourth tab, keeping Library initial.
- Planned/manual selection.
- Focus + rail, phone switcher, step controls, timer ring, and timer tray.

### D. Reliability and attention

- Persistent cache and offline queue.
- Poll/focus synchronization.
- Mobile local and browser-alive notifications.
- Alert ownership, screen wake, and deterministic Next attention.

Each sub-project receives its own plan and verification checkpoint. A must land
before session snapshots. B must land before C can persist sessions. C and D may
overlap only after shared interfaces stabilize.

## Documentation During Implementation

Behavior-changing implementation must update CLAUDE.md in the same change:

- Product and app surface summaries.
- Web and mobile navigation.
- API surface and Alembic head.
- Recipe tutorial fields and cooking-session architecture.
- User-scoped storage keys.
- Notification dependencies and limitations.
- New environment variables or deployment requirements.

This specification records approved intent; it does not claim Cook is implemented.
