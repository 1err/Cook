import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  applyOptimisticCookingAction,
  type CookingAction,
  type CookingActionPayload,
  type CookingSession,
} from "@cooking/shared";
import { useApiClient } from "../../lib/api";

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

export type MobileCookingSessionController = {
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

export function useCookingSession(): MobileCookingSessionController {
  const apiClient = useApiClient();
  const [status, setStatus] = useState<MobileCookingSessionController["status"]>("loading");
  const [session, setSession] = useState<CookingSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const sessionRef = useRef<CookingSession | null>(null);

  const storeSession = useCallback((next: CookingSession | null) => {
    sessionRef.current = next;
    setSession(next);
    setSelectedDishId((current) =>
      current && next?.dishes.some((dish) => dish.id === current)
        ? current
        : (next?.dishes[0]?.id ?? null),
    );
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      storeSession(await apiClient.cooking.active());
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load cooking session");
      setStatus("error");
    }
  }, [apiClient, storeSession]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(poll);
  }, [refresh]));

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
    try {
      storeSession(applyOptimisticCookingAction(previous, dishId, stepId, payload));
      storeSession(await apiClient.cooking.action(previous.id, stepId, payload));
    } catch (caught) {
      storeSession(previous);
      setActionError(caught instanceof Error ? caught.message : "Could not update cooking step");
    }
  }, [apiClient, storeSession]);

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
