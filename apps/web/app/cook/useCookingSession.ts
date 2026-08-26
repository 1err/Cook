"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyOptimisticCookingAction,
  type CookingAction,
  type CookingActionPayload,
  type CookingSession,
} from "@cooking/shared";
import { webApiClient } from "../lib/api";

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
};

export function useCookingSession(): CookingSessionController {
  const [status, setStatus] = useState<CookingSessionController["status"]>("loading");
  const [session, setSession] = useState<CookingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const sessionRef = useRef<CookingSession | null>(null);

  const storeSession = useCallback((next: CookingSession | null) => {
    sessionRef.current = next;
    setSession(next);
    setSelectedDishId((current) => {
      if (current && next?.dishes.some((dish) => dish.id === current)) return current;
      const requested = typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("dish");
      if (requested && next?.dishes.some((dish) => dish.id === requested)) return requested;
      return next?.dishes[0]?.id ?? null;
    });
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const active = await webApiClient.cooking.active();
      storeSession(active);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load cooking session");
      setStatus("error");
    }
  }, [storeSession]);

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
      try {
        storeSession(applyOptimisticCookingAction(previous, dishId, stepId, payload));
        const canonical = await webApiClient.cooking.action(previous.id, stepId, payload);
        storeSession(canonical);
      } catch (caught) {
        storeSession(previous);
        setActionError(caught instanceof Error ? caught.message : "Could not update cooking step");
      }
    },
    [storeSession],
  );

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
    selectedDishId,
    refresh,
    acceptSession,
    focusDish,
    applyAction,
    addDishes,
    removeDish,
    finishSession,
    discardSession,
  };
}
