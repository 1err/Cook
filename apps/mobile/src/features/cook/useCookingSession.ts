import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
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
import { useApiClient } from "../../lib/api";
import { readCookingStorage, updateCookingStorage } from "./storage";

const DEVICE_ID_KEY = "cooking-session-device-id";
let memoryDeviceId: string | null = null;

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function getDeviceId(): Promise<string> {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (saved) return (memoryDeviceId = saved);
    const created = randomId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    return (memoryDeviceId = created);
  } catch {
    return (memoryDeviceId = randomId());
  }
}

export const getCookingDeviceId = getDeviceId;

export type MobileCookingSessionController = {
  status: "loading" | "ready" | "error";
  session: CookingSession | null;
  error: string | null;
  actionError: string | null;
  sessionBusy: boolean;
  pendingCount: number;
  notice: "cook.offline.saved" | "cook.offline.cached" | "cook.conflict.reloaded" | null;
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

async function emptyEnvelope(userId: string): Promise<CookingSessionCacheEnvelope> {
  return {
    version: 1,
    user_id: userId,
    session: null,
    queue: [],
    device_id: await getDeviceId(),
    preferences: defaultCookingSessionPreferences(),
    updated_at: new Date().toISOString(),
  };
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

function isRetryableReplayFailure(error: unknown): boolean {
  return isNetworkFailure(error) || (
    error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

export function useCookingSession(userId: string | null = null): MobileCookingSessionController {
  const apiClient = useApiClient();
  const [status, setStatus] = useState<MobileCookingSessionController["status"]>("loading");
  const [session, setSession] = useState<CookingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState<MobileCookingSessionController["notice"]>(null);
  const [preferences, setPreferences] = useState<CookingSessionPreferences>(defaultCookingSessionPreferences);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const sessionRef = useRef<CookingSession | null>(null);
  const replayRef = useRef<() => Promise<void>>(async () => undefined);
  const replayInFlight = useRef<Promise<void> | null>(null);
  const preferencesRef = useRef(preferences);
  const preferencesTouchedRef = useRef(false);
  const preferencesUserRef = useRef(userId);
  const sessionUserRef = useRef(userId);

  useEffect(() => {
    if (sessionUserRef.current === userId) return;
    sessionUserRef.current = userId;
    sessionRef.current = null;
    setSession(null);
    setSelectedDishId(null);
    setPendingCount(0);
    setNotice(null);
    setStatus("loading");
  }, [userId]);

  useEffect(() => {
    if (preferencesUserRef.current === userId) return;
    preferencesUserRef.current = userId;
    preferencesTouchedRef.current = false;
    const next = defaultCookingSessionPreferences();
    preferencesRef.current = next;
    setPreferences(next);
  }, [userId]);

  const updatePreferences = useCallback((patch: Partial<CookingSessionPreferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    preferencesTouchedRef.current = true;
    setPreferences(next);
    if (userId) {
      void (async () => {
        await updateCookingStorage(userId, async (current) => ({
          ...(current ?? await emptyEnvelope(userId)),
          preferences: next,
          updated_at: new Date().toISOString(),
        }));
      })();
    }
  }, [userId]);

  const persistSession = useCallback(async (next: CookingSession | null) => {
    if (!userId) return;
    await updateCookingStorage(userId, async (current) => ({
      ...(current ?? await emptyEnvelope(userId)),
      session: next,
      updated_at: new Date().toISOString(),
    }));
  }, [userId]);

  const storeSession = useCallback((next: CookingSession | null) => {
    sessionRef.current = next;
    setSession(next);
    void persistSession(next);
    setSelectedDishId((current) =>
      current && next?.dishes.some((dish) => dish.id === current)
        ? current
        : (next?.dishes[0]?.id ?? null),
    );
  }, [persistSession]);

  const refresh = useCallback(async () => {
    const requestedUserId = userId;
    setError(null);
    try {
      const active = await apiClient.cooking.active();
      if (sessionUserRef.current !== requestedUserId) return;
      storeSession(active);
      setNotice((current) => current === "cook.offline.cached" ? null : current);
      setStatus("ready");
      await replayRef.current();
    } catch (caught) {
      if (sessionUserRef.current !== requestedUserId) return;
      if (isNetworkFailure(caught)) {
        const cached = !sessionRef.current && userId ? await readCookingStorage(userId) : null;
        if (cached?.session && !sessionRef.current) {
          storeSession(cached.session);
          setPendingCount(cached.queue.length);
        }
        if (sessionRef.current || cached?.session) {
          setNotice("cook.offline.cached");
          setStatus("ready");
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : "Could not load cooking session");
      setStatus("error");
    }
  }, [apiClient, storeSession, userId]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const poll = setInterval(() => {
      if (AppState.currentState !== "background" && AppState.currentState !== "inactive") void refresh();
    }, 5_000);
    return () => clearInterval(poll);
  }, [refresh]));

  useEffect(() => {
    if (!userId) return;
    void readCookingStorage(userId).then((cached) => {
      if (!cached) return;
      setPendingCount(cached.queue.length);
      if (!preferencesTouchedRef.current) {
        preferencesRef.current = cached.preferences;
        setPreferences(cached.preferences);
      }
      if (cached.session && !sessionRef.current) storeSession(cached.session);
      if (cached.session) setStatus("ready");
    });
  }, [storeSession, userId]);

  const acceptSession = useCallback((next: CookingSession | null) => {
    storeSession(next);
    setError(null);
    setActionError(null);
    setStatus("ready");
  }, [storeSession]);

  const focusDish = useCallback((dishId: string) => setSelectedDishId(dishId), []);

  const applyAction = useCallback(async (
    dishId: string,
    stepId: string,
    action: CookingAction,
    extensionSeconds?: number,
  ) => {
    const previous = sessionRef.current;
    if (!previous) return;
    const step = previous.dishes.find((dish) => dish.id === dishId)?.steps.find((item) => item.id === stepId);
    if (!step) return;
    const payload: CookingActionPayload = {
      action,
      mutation_id: randomId(),
      device_id: await getDeviceId(),
      occurred_at: new Date().toISOString(),
      expected_revision: step.revision,
      ...(extensionSeconds === undefined ? {} : { extension_seconds: extensionSeconds }),
    };
    setActionError(null);
    const optimistic = applyOptimisticCookingAction(previous, dishId, stepId, payload);
    try {
      storeSession(optimistic);
      storeSession(await apiClient.cooking.action(previous.id, stepId, payload));
    } catch (caught) {
      if (userId && isNetworkFailure(caught)) {
        const queued: QueuedCookingAction = {
          session_id: previous.id,
          dish_id: dishId,
          step_id: stepId,
          payload,
          enqueued_at: new Date().toISOString(),
        };
        const envelope = await updateCookingStorage(userId, async (current) => {
          const base = current ?? await emptyEnvelope(userId);
          return {
            ...base,
            session: optimistic,
            queue: enqueueCookingAction(base.queue, queued),
            updated_at: new Date().toISOString(),
          };
        });
        setPendingCount(envelope.queue.length);
        setNotice("cook.offline.saved");
      } else {
        storeSession(previous);
        setActionError(caught instanceof Error ? caught.message : "Could not update cooking step");
      }
    }
  }, [apiClient, storeSession, userId]);

  const replayQueue = useCallback(async () => {
    if (!userId) return;
    if (replayInFlight.current) return replayInFlight.current;
    const run = (async () => {
      let envelope = await readCookingStorage(userId);
      if (!envelope?.queue.length) return;
      for (const queued of envelope.queue) {
        try {
          const canonical = await apiClient.cooking.action(queued.session_id, queued.step_id, queued.payload);
          storeSession(canonical);
          envelope = await updateCookingStorage(userId, (current) => ({
            ...(current ?? envelope!),
            queue: removeQueuedCookingAction((current ?? envelope!).queue, queued.payload.mutation_id),
            updated_at: new Date().toISOString(),
          }));
          setPendingCount(envelope.queue.length);
          if (!envelope.queue.length) setNotice(null);
        } catch (caught) {
          if (isRetryableReplayFailure(caught)) break;
          envelope = await updateCookingStorage(userId, (current) => ({
            ...(current ?? envelope!),
            queue: removeQueuedCookingAction((current ?? envelope!).queue, queued.payload.mutation_id),
            updated_at: new Date().toISOString(),
          }));
          setPendingCount(envelope.queue.length);
          if (caught instanceof ApiError && caught.status === 409) {
            storeSession(await apiClient.cooking.active());
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
  }, [apiClient, storeSession, userId]);
  replayRef.current = replayQueue;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const runSessionMutation = useCallback(async (
    mutation: (sessionId: string) => Promise<CookingSession | null>,
  ) => {
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
  }, [storeSession]);

  const addDishes = useCallback(
    (recipeIds: string[]) => runSessionMutation((id) => apiClient.cooking.addDishes(id, recipeIds)),
    [apiClient, runSessionMutation],
  );
  const removeDish = useCallback(
    (dishId: string) => runSessionMutation((id) => apiClient.cooking.removeDish(id, dishId)),
    [apiClient, runSessionMutation],
  );
  const finishSession = useCallback(
    () => runSessionMutation(async (id) => {
      await apiClient.cooking.finish(id);
      return null;
    }),
    [apiClient, runSessionMutation],
  );
  const discardSession = useCallback(
    () => runSessionMutation(async (id) => {
      await apiClient.cooking.discard(id);
      return null;
    }),
    [apiClient, runSessionMutation],
  );

  return {
    status,
    session,
    error,
    actionError,
    sessionBusy,
    pendingCount,
    notice,
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
