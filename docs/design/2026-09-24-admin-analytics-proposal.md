# Chef World administrator analytics proposal

Status: approved and deployed to production on September 24, 2026. Account reset, analytics migration, ECS rollout, and Vercel promotion are verified.

## Outcome

Give the owner one place to understand who registered, who uses Chef World,
where visitors come from, and whether new users return and use the product.
Preserve the existing Library, Planner, Shopping, Cook, and Store cache flows.
Replace the Design system menu entry with Dashboard. Retain the design-system
source as an internal development resource.

Account deletion is separate from analytics. The owner explicitly authorized deleting all non-admin accounts on September 24, 2026; the backed-up reset is complete. Preserve the existing administrator account and
its account UUID; recreating an account with the same email does not preserve
the current UUID-based administrator permission.

## Current evidence

- Account records contain email, UUID, registration time, and sharing preference.
- Backend administrator checks use configured account UUIDs.
- The inspected code has no durable login history, page-view history, acquisition
  attribution, or product analytics events.
- Saved recipe and meal-plan totals can be read now. They are current inventory,
  not a historical record of use. Completed cooking sessions are removed, so
  the active-session table cannot measure lifetime cooking completions.
- Existing users and signup dates can populate the dashboard immediately.
  Other metrics begin when tracking is deployed; show “Not tracked yet” for
  earlier periods rather than displaying invented zeroes or inferred logins.

## Dashboard

Use the app's current warm editorial styling and existing account menu.
The default range is 30 days, with 7-day, 90-day, and custom date filters.
Display the reporting timezone, last refresh time, tracking start date, and
whether internal/test traffic is excluded.

| View | Contents |
| --- | --- |
| Overview | Total registered accounts; new registrations; unique active accounts; successful logins and unique accounts logging in; visits and visitors; signup and activity trends; prior-period comparison |
| Users | Searchable, paginated email directory; signup date; administrator/test status; last login; last meaningful activity; login count; current recipe/plan totals; selected user's activity timeline; CSV export |
| Acquisition | Landing pages; referrer domains; allowlisted campaign tags; device class; browser family; anonymous visits; visitor-to-signup conversion where attribution is available |
| Engagement | New-user activation; recipe saves/imports; planning actions; cooking starts/completions; retailer handoff clicks; return rates; weekly signup cohorts and retention |

No names are available from registration, so “who” means the account email.
Anonymous visitors remain anonymous unless their own browser session is linked
to their subsequent signup/login. Never infer an anonymous visitor's email.

## Metric definitions

- A visit ends after 30 minutes of inactivity. Visitor IDs are random first-party
  browser identifiers, not verified people; cookie clearing, device changes,
  blockers, and bots can affect counts. Do not fingerprint visitors.
- Successful logins count confirmed authentication events. Registration starts
  a signed-in session but is tracked separately from a password login.
- Active users count distinct authenticated accounts performing a meaningful
  action or viewing a product page. Background polling, token checks, and admin
  page views do not count as activity.
- Activation means saving the first recipe, by import or catalog/friend copy,
  within seven days of registration. Show the next steps separately: planning
  a meal, starting a cooking session, and completing a cooking session.
- Weekly retention groups accounts by signup week and counts meaningful return
  activity in subsequent calendar weeks. Label the timezone and do not display
  unfinished cohort periods as final results.
- Visitor-to-signup conversion uses observed visitor sessions with an associated
  successful signup. Display unattributed signups separately; do not imply all
  signups can be matched to a marketing source.
- Retailer handoff clicks measure outbound intent, not completed carts,
  purchases, revenue, or attributed commissions.
- Default traction reports exclude administrator and explicitly marked test
  accounts. The account directory still lists them, with clear labels. Do not
  automatically classify or delete an account just because its email looks
  like a test address.

## Implementation approach

Recommended: build a small first-party analytics layer using the existing
FastAPI/PostgreSQL backend, with the dashboard in the existing Next.js app.
This keeps account reporting and event definitions together and requires no
new analytics-provider account. It does create ongoing work to maintain event
quality, aggregation, and retention.

Alternatives: a third-party product-analytics service gives richer exploration
but adds a provider, pricing, and identity/disclosure configuration; a directory
and signup chart alone is simpler but cannot answer traffic or retention.

Proposed boundaries:

1. Add indexed analytics events with a unique event ID, server timestamp, event
   type, nullable authenticated account ID, optional visitor/session ID,
   platform, and tightly allowlisted metadata. Backfill no invented events.
2. Record registration, successful login, recipe save/import, planning, cooking,
   and supported retailer actions at their successful server operation. Resolve
   identity from authentication, never a client-supplied account ID. Deduplicate
   retries; failed operations must not count as successes.
3. Record web page views and acquisition context with a small client tracker.
   Normalize paths; strip query strings and recipe/account IDs. Keep only
   referrer domains and explicitly bounded campaign values. Support existing
   browser privacy choices. Label native activity separately; anonymous traffic
   in this initial dashboard refers to the website.
4. Add administrator-only summary, timeseries, user-list, user-detail, and export
   endpoints. Enforce authorization on the server for every request. Paginate
   the directory and bound event queries and exports. Escape spreadsheet
   formulas in exported values.
5. Use indexes and daily aggregates for charts. Keep raw events for 90 days and
   non-identifying aggregates for 13 months. Pruning runs in bounded batches.
   Account deletion removes account-linked analytic detail too.
6. Apply strict event schemas, payload limits, and ingestion rate limits. Do not
   record passwords, tokens, recipe contents, raw IPs, full URLs, or keystrokes.
   Separate untrusted client traffic counts from server-confirmed conversions.
   Instrumentation failures must not prevent login or core cooking actions;
   monitor collection failures and show known data gaps.
7. Update the published privacy explanation alongside the feature. Record the
   collection start date and avoid claiming analytics worked before that date.

## Validation and delivery

Build in an isolated checkout because the working tree contains unrelated work.
Validate administrator access, non-admin rejection, registration/login event
semantics, duplicate suppression, range/timezone boundaries, internal exclusions,
cohort maturity, and export handling. Verify the dashboard with deterministic
fixtures and browser checks at desktop and phone sizes. Fixtures must never
appear as real production traction.

Review the resulting local dashboard before production rollout. Deploy the
schema before dependent code, verify actual event collection with a labeled test
account, and check that primary product flows still work. Keep actual user emails
out of committed fixtures, screenshots, and public repository documents.

## Optional account reset

Before any deletion, present the exact account list and the counts of affected
recipes, public catalog entries, plans, and cooking data. Keep a verified backup,
preserve the existing administrator UUID and intended public catalog content,
and obtain explicit authorization for the final deletion set. Review uploaded
images, copied content, and account-scoped counters separately from foreign-key
cascades. No reset or delete control is part of this dashboard proposal.
