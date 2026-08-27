"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyOptimisticCookingAction,
  defaultCookingSessionPreferences,
  enqueueCookingAction,
  removeQueuedCookingAction,
  type CookingAction,
  type CookingActionPayload,
  type CookingSession,
  type CookingSessionCacheEnvelope,
  type CookingSessionPreferences,
  type QueuedCookingAction,
} from "@cooking/shared";
import { ApiError } from "@cooking/api-client";
import { webApiClient } from "../lib/api";
import { readCookingStorage, writeCookingStorage } from "./cookingStorage";

const DEVICE_ID_KEY = "cooking-session-device-id";
let memoryDeviceId: string | null = null;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY);
    if (saved) return (memoryDeviceId = saved);
    const created = randomId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return (memoryDeviceId = created);
  } catch {
    return (memoryDeviceId = randomId());
  }
}

export type CookingSessionController = {
  status: "loading" | "ready" | "error";
  session: CookingSession | null;
  error: string | null;
  actionError: string | null;
  sessionBusy: boolean;
  pendingCount: number;
  notice: "cook.offline.saved" | "cook.offline.cached" | "cook.conflict.reloaded" | null;
  deviceId: string;
  preferences: CookingSessionPreferences;
  selectedDishId: string | null;
  refresh: () => Promise<void>;
  acceptSession: (session: CookingSession | null) => void;
  focusDish: (dishId: string) => void;
  applyAction: (
    dishId: string,
    stepId: string,
    action: CookingAction,
    extensionSeconds?: number,
  ) => Promise<void>;
  addDishes: (recipeIds: string[]) => Promise<void>;
  removeDish: (dishId: string) => Promise<void>;
  finishSession: () => Promise<void>;
  discardSession: () => Promise<void>;
  replayQueue: () => Promise<void>;
  updatePreferences: (patch: Partial<CookingSessionPreferences>) => void;
};

function emptyEnvelope(userId: string): CookingSessionCacheEnvelope {
  return {
    version: 1,
    user_id: userId,
    session: null,
    queue: [],
    device_id: getDeviceId(),
    preferences: defaultCookingSessionPreferences(),
    updated_at: new Date().toISOString(),
  };
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}

function isRetryableReplayFailure(error: unknown): boolean {
  return isNetworkFailure(error) || (
    error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

export function useCookingSession(userId: string | null = null): CookingSessionController {
  const initialCache = useRef(userId ? readCookingStorage(userId) : null).current;
  const [status, setStatus] = useState<CookingSessionController["status"]>(
    initialCache?.session ? "ready" : "loading",
  );
  const [session, setSession] = useState<CookingSession | null>(initialCache?.session ?? null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(() =>
    initialCache?.queue.length ?? 0,
  );
  const [notice, setNotice] = useState<CookingSessionController["notice"]>(null);
  const [preferences, setPreferences] = useState<CookingSessionPreferences>(() =>
    initialCache?.preferences ?? defaultCookingSessionPreferences(),
  );
  const [selectedDishId, setSelectedDishId] = useState<string | null>(initialCache?.session?.dishes[0]?.id ?? null);
  const sessionRef = useRef<CookingSession | null>(initialCache?.session ?? null);
  const replayRef = useRef<() => Promise<void>>(async () => undefined);
  const replayInFlight = useRef<Promise<void> | null>(null);
  const preferencesRef = useRef(preferences);
  const sessionUserRef = useRef(userId);

  useEffect(() => {
    if (sessionUserRef.current === userId) return;
    sessionUserRef.current = userId;
    const cached = userId ? readCookingStorage(userId) : null;
    sessionRef.current = cached?.session ?? null;
    setSession(cached?.session ?? null);
    setSelectedDishId(cached?.session?.dishes[0]?.id ?? null);
    setPendingCount(cached?.queue.length ?? 0);
    setNotice(null);
    setStatus(cached?.session ? "ready" : "loading");
  }, [userId]);

  useEffect(() => {
    const next = userId
      ? (readCookingStorage(userId)?.preferences ?? defaultCookingSessionPreferences())
      : defaultCookingSessionPreferences();
    preferencesRef.current = next;
    setPreferences(next);
  }, [userId]);

  const updatePreferences = useCallback((patch: Partial<CookingSessionPreferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    setPreferences(next);
    if (userId) {
      const current = readCookingStorage(userId) ?? emptyEnvelope(userId);
      writeCookingStorage(userId, { ...current, preferences: next, updated_at: new Date().toISOString() });
    }
  }, [userId]);

  const storeSession = useCallback((next: CookingSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (userId) {
      const current = readCookingStorage(userId) ?? emptyEnvelope(userId);
      writeCookingStorage(userId, { ...current, session: next, updated_at: new Date().toISOString() });
    }
    setSelectedDishId((current) => {
      if (current && next?.dishes.some((dish) => dish.id === current)) return current;
      const requested = typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("dish");
      if (requested && next?.dishes.some((dish) => dish.id === requested)) return requested;
      return next?.dishes[0]?.id ?? null;
    });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const cached = readCookingStorage(userId);
    if (!cached) return;
    setPendingCount(cached.queue.length);
    if (cached.session && !sessionRef.current) {
      storeSession(cached.session);
      setStatus("ready");
    }
  }, [storeSession, userId]);

  const refresh = useCallback(async () => {
    const requestedUserId = userId;
    setError(null);
    try {
      const active = await webApiClient.cooking.active();
      if (sessionUserRef.current !== requestedUserId) return;
      storeSession(active);
      setNotice((current) => current === "cook.offline.cached" ? null : current);
      setStatus("ready");
      await replayRef.current();
    } catch (caught) {
      if (sessionUserRef.current !== requestedUserId) return;
      if (sessionRef.current && isNetworkFailure(caught)) {
        setNotice("cook.offline.cached");
        setStatus("ready");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not load cooking session");
      setStatus("error");
    }
  }, [storeSession, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", refreshIfVisible);
    const poll = window.setInterval(refreshIfVisible, 5_000);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      window.clearInterval(poll);
    };
  }, [refresh]);

  const acceptSession = useCallback((next: CookingSession | null) => {
    storeSession(next);
    setError(null);
    setActionError(null);
    setStatus("ready");
  }, [storeSession]);

  const focusDish = useCallback((dishId: string) => {
    setSelectedDishId(dishId);
  }, []);

  const applyAction = useCallback(
    async (
      dishId: string,
      stepId: string,
      action: CookingAction,
      extensionSeconds?: number,
    ) => {
      const previous = sessionRef.current;
      if (!previous) return;
      const step = previous.dishes
        .find((dish) => dish.id === dishId)
        ?.steps.find((item) => item.id === stepId);
      if (!step) return;
      const payload: CookingActionPayload = {
        action,
        mutation_id: randomId(),
        device_id: getDeviceId(),
        occurred_at: new Date().toISOString(),
        expected_revision: step.revision,
        ...(extensionSeconds === undefined ? {} : { extension_seconds: extensionSeconds }),
      };
      setActionError(null);
      const optimistic = applyOptimisticCookingAction(previous, dishId, stepId, payload);
      try {
        storeSession(optimistic);
        const canonical = await webApiClient.cooking.action(previous.id, stepId, payload);
        storeSession(canonical);
      } catch (caught) {
        if (userId && isNetworkFailure(caught)) {
          const current = readCookingStorage(userId) ?? emptyEnvelope(userId);
          const queued: QueuedCookingAction = {
            session_id: previous.id,
            dish_id: dishId,
            step_id: stepId,
            payload,
            enqueued_at: new Date().toISOString(),
          };
          const queue = enqueueCookingAction(current.queue, queued);
          writeCookingStorage(userId, { ...current, session: optimistic, queue, updated_at: new Date().toISOString() });
          setPendingCount(queue.length);
          setNotice("cook.offline.saved");
        } else {
          storeSession(previous);
          setActionError(caught instanceof Error ? caught.message : "Could not update cooking step");
        }
      }
    },
    [storeSession],
  );

  const replayQueue = useCallback(async () => {
    if (!userId) return;
    if (replayInFlight.current) return replayInFlight.current;
    const run = (async () => {
      let envelope = readCookingStorage(userId);
      if (!envelope?.queue.length) return;
      for (const queued of envelope.queue) {
        try {
          const canonical = await webApiClient.cooking.action(
            queued.session_id,
            queued.step_id,
            queued.payload,
          );
          storeSession(canonical);
          envelope = readCookingStorage(userId) ?? envelope;
          envelope = {
            ...envelope,
            queue: removeQueuedCookingAction(envelope.queue, queued.payload.mutation_id),
            updated_at: new Date().toISOString(),
          };
          writeCookingStorage(userId, envelope);
          setPendingCount(envelope.queue.length);
          if (!envelope.queue.length) setNotice(null);
        } catch (caught) {
          if (isRetryableReplayFailure(caught)) break;
          envelope = {
            ...envelope,
            queue: removeQueuedCookingAction(envelope.queue, queued.payload.mutation_id),
            updated_at: new Date().toISOString(),
          };
          writeCookingStorage(userId, envelope);
          setPendingCount(envelope.queue.length);
          if (caught instanceof ApiError && caught.status === 409) {
            storeSession(await webApiClient.cooking.active());
            setNotice("cook.conflict.reloaded");
          }
        }
      }
    })();
    replayInFlight.current = run;
    try {
      await run;
    } finally {
      replayInFlight.current = null;
    }
  }, [storeSession, userId]);
  replayRef.current = replayQueue;

  useEffect(() => {
    const replay = () => void replayQueue();
    window.addEventListener("online", replay);
    return () => window.removeEventListener("online", replay);
  }, [replayQueue]);

  const runSessionMutation = useCallback(
    async (mutation: (sessionId: string) => Promise<CookingSession | null>) => {
      const current = sessionRef.current;
      if (!current) return;
      setSessionBusy(true);
      setActionError(null);
      try {
        storeSession(await mutation(current.id));
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "Could not update cooking session");
      } finally {
        setSessionBusy(false);
      }
    },
    [storeSession],
  );

  const addDishes = useCallback(
    (recipeIds: string[]) =>
      runSessionMutation((sessionId) => webApiClient.cooking.addDishes(sessionId, recipeIds)),
    [runSessionMutation],
  );

  const removeDish = useCallback(
    (dishId: string) =>
      runSessionMutation((sessionId) => webApiClient.cooking.removeDish(sessionId, dishId)),
    [runSessionMutation],
  );

  const finishSession = useCallback(
    () =>
      runSessionMutation(async (sessionId) => {
        await webApiClient.cooking.finish(sessionId);
        return null;
      }),
    [runSessionMutation],
  );

  const discardSession = useCallback(
    () =>
      runSessionMutation(async (sessionId) => {
        await webApiClient.cooking.discard(sessionId);
        return null;
      }),
    [runSessionMutation],
  );

  return {
    status,
    session,
    error,
    actionError,
    sessionBusy,
    pendingCount,
    notice,
    deviceId: getDeviceId(),
    preferences,
    selectedDishId,
    refresh,
    acceptSession,
    focusDish,
    applyAction,
    addDishes,
    removeDish,
    finishSession,
    discardSession,
    replayQueue,
    updatePreferences,
  };
}
