# Cooking Session Reliability and Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active cooking resilient to brief connectivity loss and app lifecycle changes, with user-scoped caches, ordered offline replay, deterministic conflict recovery, notification ownership, alarms, and screen-wake controls.

**Architecture:** A shared serializable queue contract and optimistic reducer feed platform-specific controllers. Web persists one user-scoped cache/queue in localStorage and provides browser-alive alarms; mobile persists the same logical data in AsyncStorage and schedules owned local notifications. API idempotency and expected revisions make replay safe; a rejected stale transition reloads canonical state and explains the conflict.

**Tech Stack:** Shared TypeScript, browser localStorage/Notifications/Wake Lock/Audio APIs, Expo Notifications, Expo Keep Awake, AsyncStorage, React hooks, Vitest, Jest/RNTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-cross-platform-guided-cooking-sessions-design.md`

## Global Constraints

- Cached and queued data is keyed by authenticated user ID and removed on logout; the server session remains intact.
- Only step actions queue offline. Create/add/remove/finish/discard require connectivity.
- Queue replay is ordered, uses existing mutation IDs, stops on network failure, and removes a row only after canonical success.
- A 409 stale/incompatible transition discards that queued action, reloads canonical state, and shows a concise conflict notice.
- Notification ownership is per timer step and random local device ID; non-owners never schedule duplicate system alerts.
- Timer permission denial never blocks timer operation.
- Web clearly states that its alarm requires the browser to remain open; closed-browser Web Push is not implemented.
- Expiry attracts attention but never completes a step.
- Screen wake is user-controlled and releases on session end, route blur, app background, or toggle off.

---

### Task 1: Shared persisted-queue contract and replay reducer

**Files:**
- Create: `packages/shared/src/cookingSessionQueue.ts`
- Create: `packages/shared/src/cookingSessionQueue.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `QueuedCookingAction`, `CookingSessionCacheEnvelope`, `enqueueCookingAction`, `removeQueuedCookingAction`, `replaceCachedSession`, and `parseCookingSessionCache`.
- Consumes: shared `CookingSession` and `CookingActionPayload`.

- [ ] **Step 1: Write failing serialization and queue tests**

```ts
test("deduplicates by mutation id while retaining FIFO order", () => {
  const queue = enqueueCookingAction([queued("m1")], queued("m1"));
  expect(queue.map(item => item.payload.mutation_id)).toEqual(["m1"]);
});

test("rejects another user's or malformed cache envelope", () => {
  expect(parseCookingSessionCache(envelope({ user_id: "other" }), "current")).toBeNull();
  expect(parseCookingSessionCache({ version: 1, queue: "bad" }, "current")).toBeNull();
});

test("preserves the mutation payload used for optimistic state", () => {
  const item = queued("m2");
  expect(JSON.parse(JSON.stringify(item))).toEqual(item);
});
```

- [ ] **Step 2: Run shared queue tests and verify RED**

Run: `npm --workspace @cooking/shared test -- cookingSessionQueue.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement versioned, defensive cache parsing and immutable FIFO operations**

Use envelope version `1`, `user_id`, `session`, `queue`, `device_id`, `preferences`, and `updated_at`. Invalid session/queue shapes return `null` rather than throwing. Never accept a cache whose `user_id` differs from the authenticated user.

- [ ] **Step 4: Run shared tests and typecheck**

Run: `npm --workspace @cooking/shared test && npx tsc -p packages/shared/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cookingSessionQueue.ts packages/shared/src/cookingSessionQueue.test.ts packages/shared/src/index.ts
git commit -m "feat(cook): add offline action queue contract"
```

---

### Task 2: Web user-scoped cache, offline queue, and conflict recovery

**Files:**
- Create: `apps/web/app/cook/cookingStorage.ts`
- Create: `apps/web/app/cook/cookingStorage.test.ts`
- Modify: `apps/web/app/cook/useCookingSession.ts`
- Modify: `apps/web/app/cook/useCookingSession.test.tsx`
- Modify: `apps/web/app/lib/auth.tsx`
- Modify: `apps/web/app/lib/auth.test.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces key `cookingSession:v1:{userId}` and complete logout clearing.
- Enhances web controller with cached bootstrap, offline markings, queued actions, ordered replay, and conflict notice.

- [ ] **Step 1: Write failing storage isolation tests**

```ts
test("reads only the current user's cached session", () => {
  localStorage.setItem(cookingStorageKey("alice"), JSON.stringify(envelope({ user_id: "alice" })));
  expect(readCookingStorage("alice")?.user_id).toBe("alice");
  expect(readCookingStorage("bob")).toBeNull();
});

test("logout clears cooking storage but not unrelated preferences", async () => {
  localStorage.setItem(cookingStorageKey("alice"), "{}");
  localStorage.setItem("theme", "warm");
  await logout();
  expect(localStorage.getItem(cookingStorageKey("alice"))).toBeNull();
  expect(localStorage.getItem("theme")).toBe("warm");
});
```

- [ ] **Step 2: Write failing controller replay tests**

```ts
test("queues a step action when fetch is offline and keeps the optimistic view", async () => {
  mockAction.mockRejectedValue(new TypeError("Failed to fetch"));
  await act(() => result.current.complete("dish-1", "step-1"));
  expect(result.current.session?.dishes[0].steps[0].state).toBe("completed");
  expect(readCookingStorage(USER_ID)?.queue).toHaveLength(1);
});

test("replays in FIFO order and removes only acknowledged mutations", async () => {
  seedQueue([queued("m1"), queued("m2")]);
  mockAction.mockResolvedValueOnce(serverAfterM1).mockResolvedValueOnce(serverAfterM2);
  await act(() => result.current.replayQueue());
  expect(mockAction.mock.calls.map(call => call[2].mutation_id)).toEqual(["m1", "m2"]);
  expect(readCookingStorage(USER_ID)?.queue).toEqual([]);
});

test("reloads canonical state and explains a revision conflict", async () => {
  seedQueue([queued("stale")]);
  mockAction.mockRejectedValue(apiConflict("revision_conflict"));
  await act(() => result.current.replayQueue());
  expect(mockActive).toHaveBeenCalled();
  expect(result.current.notice).toBe("This step changed on another device. We reloaded the latest progress.");
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm --workspace @cooking/web test -- cookingStorage.test.ts useCookingSession.test.tsx auth.test.tsx`

Expected: FAIL because persistent Cook storage/replay is absent.

- [ ] **Step 4: Implement storage, cached bootstrap, offline detection, FIFO replay, and logout cleanup**

Treat `TypeError`/navigator offline as queueable network failures. API 4xx/5xx errors are not offline and must rollback. Mark pending actions in UI. Trigger replay on `online`, focus, and before polling; serialize replay with one promise/ref so concurrent triggers cannot duplicate work.

- [ ] **Step 5: Run focused tests and web typecheck**

Run: `npm --workspace @cooking/web test -- cookingStorage.test.ts useCookingSession.test.tsx auth.test.tsx && npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/cook apps/web/app/lib/auth.tsx apps/web/app/lib/auth.test.tsx packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): keep web sessions usable offline"
```

---

### Task 3: Mobile user-scoped cache, queue replay, and logout isolation

**Files:**
- Create: `apps/mobile/src/features/cook/storage.ts`
- Create: `apps/mobile/src/features/cook/storage.test.ts`
- Modify: `apps/mobile/src/features/cook/useCookingSession.ts`
- Modify: `apps/mobile/src/features/cook/useCookingSession.test.tsx`
- Modify: `apps/mobile/src/lib/storage.ts`
- Modify: `apps/mobile/src/lib/auth.tsx`
- Modify: `apps/mobile/src/lib/auth.test.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces `cookingSession:v1:{userId}` AsyncStorage key and `cookingSession:` logout prefix.
- Enhances native controller with cached startup, pending markers, AppState/network retry triggers, and canonical conflict recovery.

- [ ] **Step 1: Write failing mobile storage and logout tests**

```ts
test("persists one envelope per user", async () => {
  await writeCookingStorage("alice", envelope({ user_id: "alice" }));
  expect(await readCookingStorage("alice")).toMatchObject({ user_id: "alice" });
  expect(await readCookingStorage("bob")).toBeNull();
});

test("clearUserScopedPersistent removes cooking cache and queue", async () => {
  await AsyncStorage.setItem("cookingSession:v1:alice", "{}");
  await clearUserScopedPersistent();
  expect(await AsyncStorage.getItem("cookingSession:v1:alice")).toBeNull();
});
```

- [ ] **Step 2: Write failing replay/lifecycle tests**

Verify optimistic offline action, FIFO replay, 409 conflict recovery, no polling while backgrounded, immediate refresh/replay when active, and cache replacement from canonical reads.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- storage.test.ts useCookingSession.test.tsx auth.test.tsx`

Expected: FAIL because Cook persistence is absent.

- [ ] **Step 4: Implement storage, queue, AppState replay, and logout cleanup**

No network-state dependency is required: queue only fetch network failures and retry on app foreground plus each focused poll. Serialize replay and use the same stable conflict copy as web.

- [ ] **Step 5: Run focused tests and mobile typecheck**

Run: `npm --workspace @cooking/mobile test -- storage.test.ts useCookingSession.test.tsx auth.test.tsx && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/cook apps/mobile/src/lib/storage.ts apps/mobile/src/lib/auth.tsx apps/mobile/src/lib/auth.test.tsx packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): keep native sessions usable offline"
```

---

### Task 4: Web browser-alive alarms and alert ownership

**Files:**
- Create: `apps/web/app/cook/useCookingAlerts.ts`
- Create: `apps/web/app/cook/useCookingAlerts.test.tsx`
- Create: `apps/web/app/cook/cookingNotifications.ts`
- Create: `apps/web/app/cook/cookingNotifications.test.ts`
- Modify: `apps/web/app/cook/CookWorkspace.tsx`
- Modify: `apps/web/app/cook/CookWorkspace.test.tsx`
- Modify: `apps/web/app/cook/CookPage.module.css`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Produces permission/preferences UI, owned timer scheduling, expiry sound/notification, and `Take over alerts` action.

- [ ] **Step 1: Write failing permission, ownership, and expiry tests**

```ts
test("does not request notification permission until the user enables alerts", async () => {
  renderHook(() => useCookingAlerts(options));
  expect(Notification.requestPermission).not.toHaveBeenCalled();
});

test("only the owner device emits a system notification", () => {
  notifyExpiredStep(stepFixture({ notification_owner_device_id: "other" }), "this-device", prefs);
  expect(Notification).not.toHaveBeenCalled();
});

test("takeover posts the explicit idempotent ownership action", async () => {
  render(<CookWorkspace controller={nonOwnerTimerController()} />);
  await user.click(screen.getByRole("button", { name: "Take over alerts" }));
  expect(controller.takeAlertOwnership).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace @cooking/web test -- cookingNotifications.test.ts useCookingAlerts.test.tsx CookWorkspace.test.tsx`

Expected: FAIL because alert integration does not exist.

- [ ] **Step 3: Implement browser-alive notification, audio, visibility recalculation, and preferences**

Keep independent sound, vibration, and notification booleans in the user envelope. Use one timeout only for the nearest owned timer and recompute from absolute timestamps on visibility/focus. Deduplicate expiries by step ID + timer end timestamp. Display the browser-open limitation beside preferences.

- [ ] **Step 4: Run focused tests and web typecheck**

Run: `npm --workspace @cooking/web test -- cookingNotifications.test.ts useCookingAlerts.test.tsx CookWorkspace.test.tsx && npx tsc -p apps/web/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/cook packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): add browser cooking alarms"
```

---

### Task 5: Native local notifications and ownership transfer

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`
- Modify: `package-lock.json`
- Create: `apps/mobile/src/features/cook/notifications.ts`
- Create: `apps/mobile/src/features/cook/notifications.test.ts`
- Create: `apps/mobile/src/features/cook/useCookingAlerts.ts`
- Create: `apps/mobile/src/features/cook/useCookingAlerts.test.tsx`
- Modify: `apps/mobile/src/features/cook/CookWorkspace.tsx`
- Modify: `apps/mobile/src/features/cook/CookWorkspace.test.tsx`
- Modify: `apps/mobile/jest.setup.ts`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Adds SDK-compatible `expo-notifications`.
- Produces owned local notification scheduling/cancellation, permission UI, preference controls, expiry handling, and explicit alert takeover.

- [ ] **Step 1: Install the Expo-compatible notification package**

Run: `npx expo install expo-notifications --workspace @cooking/mobile`

Expected: package manifest and lockfile contain the SDK 54-compatible version.

- [ ] **Step 2: Add failing scheduling and ownership tests**

```ts
test("schedules from the absolute end timestamp for an owned running timer", async () => {
  await reconcileCookingNotifications(sessionFixture(), "device-a", prefs);
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    trigger: expect.objectContaining({ date: new Date("2026-08-27T00:10:00Z") }),
  }));
});

test("cancels stale notifications after pause, completion, removal, or ownership change", async () => {
  await reconcileCookingNotifications(noOwnedTimersFixture(), "device-a", prefs);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalled();
});

test("permission denial leaves timer controls enabled and shows a limitation", async () => {
  mockPermission("denied");
  renderWorkspace();
  expect(screen.getByText("Timers still work, but Chef World cannot alert you outside the app.")).toBeTruthy();
  expect(screen.getByText("Start timer")).not.toBeDisabled();
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm --workspace @cooking/mobile test -- notifications.test.ts useCookingAlerts.test.tsx CookWorkspace.test.tsx`

Expected: FAIL before notification integration exists.

- [ ] **Step 4: Implement notification handler, reconciliation, permissions, and takeover**

Store scheduled notification IDs by `{stepId}:{timerEndsAt}` in the user envelope. Reconcile at canonical session changes, app foreground, logout, finish, and discard. Use generic private notification content unless preview preference is enabled. Never schedule for a non-owned timer.

- [ ] **Step 5: Run focused tests and mobile typecheck**

Run: `npm --workspace @cooking/mobile test -- notifications.test.ts useCookingAlerts.test.tsx CookWorkspace.test.tsx && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json apps/mobile/jest.setup.ts apps/mobile/src/features/cook package-lock.json packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): add native timer notifications"
```

---

### Task 6: Cross-platform screen wake control

**Files:**
- Create: `apps/web/app/cook/useScreenWake.ts`
- Create: `apps/web/app/cook/useScreenWake.test.tsx`
- Modify: `apps/web/app/cook/CookWorkspace.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`
- Create: `apps/mobile/src/features/cook/useScreenWake.ts`
- Create: `apps/mobile/src/features/cook/useScreenWake.test.tsx`
- Modify: `apps/mobile/src/features/cook/CookWorkspace.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`

**Interfaces:**
- Adds SDK-compatible `expo-keep-awake`.
- Produces a persisted per-user “Keep screen awake while cooking” toggle on both platforms.

- [ ] **Step 1: Install Expo Keep Awake**

Run: `npx expo install expo-keep-awake --workspace @cooking/mobile`

Expected: SDK-compatible dependency and lockfile update.

- [ ] **Step 2: Write failing lifecycle tests**

```ts
test("web reacquires after visibility return and releases on cleanup", async () => {
  const { unmount } = renderHook(() => useScreenWake(true, true));
  expect(navigator.wakeLock.request).toHaveBeenCalledWith("screen");
  unmount();
  expect(release).toHaveBeenCalled();
});
```

```tsx
test("native activates only while a session is visible and enabled", () => {
  const { rerender } = renderHook(({ enabled, visible }) => useScreenWake(enabled, visible), {
    initialProps: { enabled: true, visible: true },
  });
  expect(activateKeepAwakeAsync).toHaveBeenCalled();
  rerender({ enabled: true, visible: false });
  expect(deactivateKeepAwake).toHaveBeenCalled();
});
```

- [ ] **Step 3: Implement both hooks and workspace toggles**

Unsupported web Wake Lock reports a quiet limitation without breaking Cook. Mobile deactivates on AppState background, route blur, finish/discard, or toggle off.

- [ ] **Step 4: Run focused tests and both typechecks**

Run: `npm --workspace @cooking/web test -- useScreenWake.test.tsx`

Run: `npm --workspace @cooking/mobile test -- useScreenWake.test.tsx`

Run: `npx tsc -p apps/web/tsconfig.json --noEmit && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/cook apps/mobile/package.json apps/mobile/src/features/cook package-lock.json packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(cook): keep screens awake during sessions"
```

---

### Task 7: Reliability E2E, cross-device contract verification, and docs

**Files:**
- Modify: `apps/web/e2e/cooking.spec.ts`
- Create: `backend/tests/test_cooking_replay_contract.py`
- Modify: `CLAUDE.md`

**Interfaces:**
- Verifies browser offline/replay/conflict behavior and backend idempotency/cross-device ordering.
- Documents all storage keys, dependencies, permissions, and limitations.

- [ ] **Step 1: Add failing backend replay contract tests**

Verify: duplicate mutation succeeds without double advancement; two devices can mutate different dishes from the same session version; the same dish rejects stale revision; pause recorded before expiry remains ordered; replay after expiry becomes attention rather than completion; ownership transfer updates only the requested timer.

- [ ] **Step 2: Add failing browser reliability scenarios**

Use Playwright context offline mode to complete one step, verify pending state survives reload, restore network, observe replay/canonical state, then simulate a 409 and verify conflict notice/reload. Verify permission denial leaves timers enabled and non-owner state exposes takeover.

- [ ] **Step 3: Run focused verification and complete implementations until GREEN**

Run: `cd backend && python -m pytest tests/test_cooking_replay_contract.py tests/test_cooking_state_machine.py tests/test_cooking_repository.py -q`

Run: `npm --workspace @cooking/web run test:e2e -- cooking.spec.ts`

Expected: PASS.

- [ ] **Step 4: Update authoritative docs**

Document `cookingSession:v1:{userId}`, offline queue semantics, 5-second visible polling, AppState/focus refresh, `expo-notifications`, `expo-keep-awake`, native plugin/config requirements, browser-open alarm limitation, notification ownership/takeover, permission behavior, and logout cleanup.

- [ ] **Step 5: Run the complete feature verification**

Run: `cd backend && python -m pytest -q`

Run: `npm --workspace @cooking/shared test && npm --workspace @cooking/api-client test`

Run: `npm run test:web && npm run test:mobile`

Run: `npx tsc -p packages/shared/tsconfig.json --noEmit && npx tsc -p packages/api-client/tsconfig.json --noEmit && npx tsc -p apps/web/tsconfig.json --noEmit && npx tsc -p apps/mobile/tsconfig.json --noEmit`

Run: `npm run web:build`

Run: `npm --workspace @cooking/web run test:e2e`

Run: `cd backend && alembic heads`

Run: `git diff --check && git status --short`

Expected: all tests/build/typechecks PASS, one Alembic head, and only intentional tracked changes.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_cooking_replay_contract.py apps/web/e2e/cooking.spec.ts CLAUDE.md
git commit -m "test(cook): verify reliable synchronized sessions"
```
