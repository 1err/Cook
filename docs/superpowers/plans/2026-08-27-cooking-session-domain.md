# Cooking Session Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the authenticated, account-synchronized cooking-session database, state machine, REST API, shared progress/recommendation contracts, and typed API client.

**Architecture:** PostgreSQL owns one normalized active session per user. Repository mutations lock the session row, validate step revisions, apply a deterministic state transition, record an idempotency key, and return a complete canonical snapshot. Pure shared TypeScript helpers mirror progress, expiry, recommendation, and optimistic transition rules for both clients without owning persistence.

**Tech Stack:** FastAPI, Pydantic 2, async SQLAlchemy, PostgreSQL/Alembic, TypeScript, Vitest, shared npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-25-cross-platform-guided-cooking-sessions-design.md`

## Global Constraints

- An account has at most one active session; every query is authenticated and filtered by `user_id`.
- Only recipes owned by the current user may be snapshotted into a session.
- Recipe edits or deletion after session creation never change the session snapshot.
- Passive expiry becomes `needs_attention`; no timer automatically completes a step.
- Completed and skipped durations count toward time-weighted progress; all other states contribute zero.
- Step mutations are idempotent by mutation UUID and reject stale revisions with stable 409 reason codes.
- Timestamps are timezone-aware UTC ISO strings and countdowns derive from absolute `timer_ends_at`.
- Existing tutorial and recipe API behavior remains backward compatible.

---

### Task 1: Shared cooking-session contracts and pure computations

**Files:**
- Create: `packages/shared/src/cookingSession.ts`
- Create: `packages/shared/src/cookingSession.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

**Interfaces:**
- Produces: `CookingSession`, `CookingDish`, `CookingStep`, `CookingStepState`, `CookingAction`, `CookingActionPayload`, `CookingRecommendation`.
- Produces: `getDishProgress(dish): number`, `getEffectiveStepState(step, nowMs): CookingStepState`, `getCookingRecommendations(session, nowMs): CookingRecommendation[]`, and `applyOptimisticCookingAction(session, dishId, stepId, payload): CookingSession`.
- Consumes: existing `IngredientItem`, `RecipeDurationSource`, `RecipeAttentionType`, and `RecipeActionType` contracts.

- [ ] **Step 1: Add failing pure-domain tests**

```ts
import { describe, expect, test } from "vitest";
import {
  applyOptimisticCookingAction,
  getCookingRecommendations,
  getDishProgress,
  getEffectiveStepState,
  type CookingDish,
  type CookingSession,
} from "./cookingSession";

test("weights progress by resolved duration", () => {
  const dish = dishFixture([120, 480], ["completed", "ready"]);
  expect(getDishProgress(dish)).toBe(20);
});

test("treats an elapsed running timer as needing attention without completing it", () => {
  const step = stepFixture({ state: "timer_running", timer_ends_at: "2026-08-27T00:00:00Z" });
  expect(getEffectiveStepState(step, Date.parse("2026-08-27T00:00:01Z"))).toBe("needs_attention");
});

test("prioritizes elapsed timers, needs-attention steps, running timers, then ready work", () => {
  expect(getCookingRecommendations(sessionFixture(), Date.parse("2026-08-27T00:00:00Z")).map(r => r.kind))
    .toEqual(["attention", "attention", "timer", "ready"]);
});

test("optimistic completion advances only the same dish", () => {
  const next = applyOptimisticCookingAction(sessionFixture(), "dish-a", "step-a1", action("complete"));
  expect(next.dishes[0].steps.map(step => step.state)).toEqual(["completed", "ready"]);
  expect(next.dishes[1]).toEqual(sessionFixture().dishes[1]);
});
```

- [ ] **Step 2: Run shared tests and verify RED**

Run: `npm --workspace @cooking/shared test`

Expected: FAIL because `cookingSession.ts` and its exports do not exist.

- [ ] **Step 3: Implement canonical contracts and pure helpers**

```ts
export type CookingStepState =
  | "locked" | "ready" | "timer_running" | "timer_paused"
  | "needs_attention" | "completed" | "skipped";

export type CookingAction =
  | "start_timer" | "pause_timer" | "resume_timer" | "extend_timer"
  | "complete" | "skip" | "reopen" | "take_alert_ownership";

export type CookingActionPayload = {
  action: CookingAction;
  mutation_id: string;
  device_id: string;
  occurred_at: string;
  expected_revision: number;
  extension_seconds?: number;
};

export function getDishProgress(dish: CookingDish): number {
  const total = dish.steps.reduce((sum, step) => sum + step.duration_seconds, 0);
  if (total <= 0) return 0;
  const resolved = dish.steps.reduce(
    (sum, step) => sum + (["completed", "skipped"].includes(step.state) ? step.duration_seconds : 0),
    0,
  );
  return resolved === total ? 100 : Math.round((resolved / total) * 100);
}
```

Implement immutable optimistic transitions with the same state rules documented for the backend. Keep the recommendation provider deterministic: elapsed running timer, persisted attention, running timer by earliest due time, then ready hands-on step by dish position.

- [ ] **Step 4: Export contracts and add a shared test script**

Add `export * from "./cookingSession";` to `packages/shared/src/index.ts` and add `"test": "vitest run"` plus `vitest` as a development dependency in the shared workspace.

- [ ] **Step 5: Run shared tests and typecheck**

Run: `npm --workspace @cooking/shared test && npx tsc -p packages/shared/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared package.json package-lock.json
git commit -m "feat(cook): add shared session contracts"
```

---

### Task 2: Cooking-session schema and ORM models

**Files:**
- Create: `backend/alembic/versions/20260827_cooking_sessions.py`
- Create: `backend/tests/test_cooking_session_migration.py`
- Modify: `backend/app/db/models.py`

**Interfaces:**
- Produces ORM models `CookingSessionModel`, `CookingSessionDishModel`, `CookingSessionStepModel`, and `CookingSessionMutationModel`.
- Produces PostgreSQL tables `cooking_sessions`, `cooking_session_dishes`, `cooking_session_steps`, and `cooking_session_mutations` with cascading session ownership.

- [ ] **Step 1: Write a failing migration behavior test**

Load the revision module, replace Alembic operations with a recorder, execute
`upgrade()`, and inspect the emitted SQLAlchemy tables and constraints rather
than grepping implementation text.

```py
def test_upgrade_emits_normalized_session_tables_and_constraints(monkeypatch):
    module = load_revision("20260827_cooking_sessions.py")
    created: dict[str, tuple[object, ...]] = {}
    monkeypatch.setattr(module.op, "create_table", lambda name, *items, **_: created.setdefault(name, items))
    monkeypatch.setattr(module.op, "create_index", lambda *args, **kwargs: None)

    module.upgrade()

    assert list(created) == [
        "cooking_sessions",
        "cooking_session_dishes",
        "cooking_session_steps",
        "cooking_session_mutations",
    ]
    session_constraints = {item.name for item in created["cooking_sessions"] if isinstance(item, sa.Constraint)}
    step_constraints = {item.name for item in created["cooking_session_steps"] if isinstance(item, sa.Constraint)}
    assert "uq_cooking_sessions_user_id" in session_constraints
    assert "ck_cooking_steps_state" in step_constraints
```

- [ ] **Step 2: Run the focused migration test and verify RED**

Run: `cd backend && python -m pytest tests/test_cooking_session_migration.py -q`

Expected: FAIL because the revision file does not exist.

- [ ] **Step 3: Add the normalized migration**

Create UUID primary keys, ownership/cascade foreign keys, ordered positions, JSONB dish snapshots, timer timestamps, revisions, and named checks for duration, state, source, attention, action, positions, and remaining seconds. Keep `recipe_id` as non-FK provenance so deleting a recipe cannot delete or invalidate an active snapshot.

- [ ] **Step 4: Add matching SQLAlchemy models and relationships**

```py
class CookingSessionModel(Base):
    __tablename__ = "cooking_sessions"
    __table_args__ = (UniqueConstraint("user_id", name="uq_cooking_sessions_user_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer(), nullable=False, default=1, server_default="1")
    dishes: Mapped[list["CookingSessionDishModel"]] = relationship(cascade="all, delete-orphan", order_by="CookingSessionDishModel.position")
```

- [ ] **Step 5: Verify migration helpers, ORM import, and a single Alembic head**

Run: `cd backend && python -m pytest tests/test_cooking_session_migration.py -q && python -c "from app.db.models import CookingSessionModel, CookingSessionDishModel, CookingSessionStepModel, CookingSessionMutationModel" && alembic heads`

Expected: PASS and exactly `20260827_cook_sess (head)`.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/20260827_cooking_sessions.py backend/app/db/models.py backend/tests/test_cooking_session_migration.py
git commit -m "feat(cook): add cooking session schema"
```

---

### Task 3: Backend schemas and deterministic state machine

**Files:**
- Create: `backend/app/cooking.py`
- Create: `backend/tests/test_cooking_state_machine.py`

**Interfaces:**
- Produces Pydantic response models `CookingSession`, `CookingDish`, and `CookingStep` matching `@cooking/shared` JSON fields.
- Produces request models `CookingSessionCreate`, `CookingDishesAdd`, and `CookingStepActionBody`.
- Produces `CookingConflict(code, message)` and `apply_step_action(dish, step, body, now)`.

- [ ] **Step 1: Write table-driven failing state-transition tests**

```py
@pytest.mark.parametrize(
    ("state", "action", "attention", "expected"),
    [
        ("ready", "start_timer", "passive", "timer_running"),
        ("timer_running", "pause_timer", "passive", "timer_paused"),
        ("timer_paused", "resume_timer", "passive", "timer_running"),
        ("ready", "complete", "hands_on", "completed"),
        ("ready", "skip", "hands_on", "skipped"),
        ("completed", "reopen", "hands_on", "ready"),
    ],
)
def test_valid_transitions(state, action, attention, expected):
    dish, step = domain_fixture(state=state, attention_type=attention)
    apply_step_action(dish, step, action_body(action), NOW)
    assert step.state == expected

def test_timer_expiry_never_completes_a_step():
    dish, step = domain_fixture(state="timer_running", timer_ends_at=NOW - timedelta(seconds=1))
    normalize_expired_timers(dish, NOW)
    assert step.state == "needs_attention"
```

Cover all invalid state/action pairs, stale revisions, hands-on timer rejection, completion advancement, reopen with active-timer rejection, extension limits, alert takeover, and final-dish resolution.

- [ ] **Step 2: Run focused state-machine tests and verify RED**

Run: `cd backend && python -m pytest tests/test_cooking_state_machine.py -q`

Expected: FAIL because `app.cooking` does not exist.

- [ ] **Step 3: Implement schemas, stable conflict codes, expiry, and transitions**

Use these stable codes: `active_session_exists`, `recipe_not_owned`, `recipe_has_no_steps`, `session_not_found`, `dish_not_found`, `step_not_found`, `revision_conflict`, `invalid_transition`, `timer_requires_passive_step`, `active_timer_blocks_reopen`, `session_not_complete`, and `invalid_extension`.

`occurred_at` is accepted for ordered offline replay; future timestamps clamp to server `now`. Starting/resuming takes notification ownership. `take_alert_ownership` changes only the owner and revision. Completing/skipping clears timer fields and unlocks the earliest locked step in the same dish.

- [ ] **Step 4: Run state-machine tests**

Run: `cd backend && python -m pytest tests/test_cooking_state_machine.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/cooking.py backend/tests/test_cooking_state_machine.py
git commit -m "feat(cook): add deterministic session state machine"
```

---

### Task 4: Transactional cooking-session repository

**Files:**
- Create: `backend/app/db/repo_cooking.py`
- Create: `backend/tests/test_cooking_repository.py`

**Interfaces:**
- Consumes: ORM models from Task 2 and state-machine models/functions from Task 3.
- Produces: `get_active_session`, `create_session`, `add_dishes`, `remove_dish`, `apply_action`, `finish_session`, and `discard_session`.

- [ ] **Step 1: Write failing repository contract tests**

```py
@pytest.mark.asyncio
async def test_create_snapshots_owned_recipe_data_and_step_metadata():
    session = FakeSession(recipes=[owned_recipe_fixture()])
    result = await create_session(session, USER_ID, ["recipe-1"])
    assert result.dishes[0].title == "Mapo tofu"
    assert result.dishes[0].steps[0].state == "ready"
    assert result.dishes[0].steps[1].state == "locked"

@pytest.mark.asyncio
async def test_duplicate_mutation_id_returns_canonical_state_without_reapplying():
    session = FakeSession(active=session_model_fixture(), applied_mutations={MUTATION_ID})
    first = await apply_action(session, USER_ID, SESSION_ID, STEP_ID, body_fixture())
    assert first.dishes[0].steps[0].revision == 3
    assert session.transition_calls == 0
```

Also cover ordering, unowned/missing recipes, empty steps, one-session conflict, row-lock request, revision conflict, user isolation, add/remove behavior, session deletion when the final dish is removed, finish guard, snapshot survival, and cascade assumptions.

- [ ] **Step 2: Run repository tests and verify RED**

Run: `cd backend && python -m pytest tests/test_cooking_repository.py -q`

Expected: FAIL because `repo_cooking` does not exist.

- [ ] **Step 3: Implement locked repository mutations and canonical mapping**

Use `select(...).where(user_id == ...).with_for_update()` before mutations. Load ordered dishes/steps with `selectinload`. Normalize expired timers on reads and mutations, incrementing affected revisions and the session version. Check the mutation UUID before expected revision, then record it only after a successful transition.

- [ ] **Step 4: Run repository and state-machine tests**

Run: `cd backend && python -m pytest tests/test_cooking_repository.py tests/test_cooking_state_machine.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/db/repo_cooking.py backend/tests/test_cooking_repository.py
git commit -m "feat(cook): persist transactional sessions"
```

---

### Task 5: Authenticated REST routes and typed API client

**Files:**
- Create: `backend/app/api/routes_cooking.py`
- Create: `backend/tests/test_cooking_routes.py`
- Modify: `backend/app/main.py`
- Modify: `packages/api-client/src/index.ts`
- Create: `packages/api-client/src/cookingClient.test.ts`
- Modify: `packages/api-client/package.json`

**Interfaces:**
- Produces the seven specified `/cooking-session` routes plus idempotent action support for `take_alert_ownership`.
- Produces `apiClient.cooking.active/create/addDishes/removeDish/action/finish/discard`.
- Produces `ApiError` carrying `status`, `code`, and canonical message for client conflict handling.

- [ ] **Step 1: Write failing route tests**

```py
@pytest.mark.asyncio
async def test_create_route_scopes_to_current_user(monkeypatch):
    calls = []
    monkeypatch.setattr(routes_cooking.repo_cooking, "create_session", recording_create(calls))
    result = await routes_cooking.create_cooking_session(
        body=CookingSessionCreate(recipe_ids=["r1"]), session=object(), current_user=user_fixture()
    )
    assert calls == [(USER_ID, ["r1"])]
    assert result.id == SESSION_ID

@pytest.mark.asyncio
async def test_conflict_has_stable_detail_shape(monkeypatch):
    monkeypatch.setattr(routes_cooking.repo_cooking, "create_session", raising_conflict("active_session_exists"))
    with pytest.raises(HTTPException) as exc:
        await routes_cooking.create_cooking_session(...)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "active_session_exists"
```

- [ ] **Step 2: Run route tests and verify RED**

Run: `cd backend && python -m pytest tests/test_cooking_routes.py -q`

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Implement and register the authenticated router**

Map domain conflicts to 409 with `{"code": code, "message": message}`. Return 404 for ownership misses. Return `null` from `GET /active` when no active session. Return the remaining active snapshot or `null` after dish removal. Register the router in `backend/app/main.py`.

- [ ] **Step 4: Write failing API-client request tests**

```ts
test("sends a typed idempotent action request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(ok(sessionFixture()));
  vi.stubGlobal("fetch", fetchMock);
  await createApiClient(options).cooking.action("s1", "st1", payloadFixture());
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.test/cooking-session/s1/steps/st1/actions",
    expect.objectContaining({ method: "POST", body: JSON.stringify(payloadFixture()) }),
  );
});

test("preserves stable conflict metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(conflict("revision_conflict")));
  await expect(createApiClient(options).cooking.active()).rejects.toMatchObject({
    status: 409,
    code: "revision_conflict",
  });
});
```

- [ ] **Step 5: Implement client methods and structured errors**

Keep existing `Error` consumers compatible by extending `Error`. Parse FastAPI `detail` when it is an object; otherwise preserve the current text fallback.

- [ ] **Step 6: Run backend, client, shared tests and typechecks**

Run: `cd backend && python -m pytest tests/test_cooking_routes.py -q`

Run: `npm --workspace @cooking/api-client test && npm --workspace @cooking/shared test && npx tsc -p packages/api-client/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes_cooking.py backend/app/main.py backend/tests/test_cooking_routes.py packages/api-client package-lock.json
git commit -m "feat(cook): expose synchronized session API"
```

---

### Task 6: Domain checkpoint verification and documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Documents: Alembic head, session tables, API routes, state semantics, revision/idempotency behavior, and deploy probe path.

- [ ] **Step 1: Update authoritative documentation**

Document that the cooking-session domain exists but client workspaces are delivered by the next plan. Set Alembic head to `20260827_cook_sess`, list all `/cooking-session` routes, and explain snapshot ownership, timer expiry, and the one-session constraint.

- [ ] **Step 2: Run the complete domain checkpoint**

Run: `cd backend && python -m pytest -q`

Run: `npm --workspace @cooking/shared test && npm --workspace @cooking/api-client test`

Run: `npx tsc -p packages/shared/tsconfig.json --noEmit && npx tsc -p packages/api-client/tsconfig.json --noEmit`

Run: `git diff --check`

Expected: all commands PASS and Alembic reports one head.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(cook): document session domain"
```
