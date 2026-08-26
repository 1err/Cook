import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseCookingSessionCache, type CookingSessionCacheEnvelope } from "@cooking/shared";

const pendingUpdates = new Map<string, Promise<void>>();

export function cookingStorageKey(userId: string): string {
  return `cookingSession:v1:${userId}`;
}

export async function readCookingStorage(userId: string): Promise<CookingSessionCacheEnvelope | null> {
  try {
    return parseCookingSessionCache(await AsyncStorage.getItem(cookingStorageKey(userId)), userId);
  } catch {
    return null;
  }
}

export async function writeCookingStorage(
  userId: string,
  envelope: CookingSessionCacheEnvelope,
): Promise<void> {
  try {
    await AsyncStorage.setItem(cookingStorageKey(userId), JSON.stringify(envelope));
  } catch {
    // Cooking remains available when persistence is temporarily unavailable.
  }
}

export async function updateCookingStorage(
  userId: string,
  update: (
    current: CookingSessionCacheEnvelope | null,
  ) => CookingSessionCacheEnvelope | Promise<CookingSessionCacheEnvelope>,
): Promise<CookingSessionCacheEnvelope> {
  const key = cookingStorageKey(userId);
  const previous = pendingUpdates.get(key) ?? Promise.resolve();
  let resolveResult!: (value: CookingSessionCacheEnvelope) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<CookingSessionCacheEnvelope>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        const envelope = await update(await readCookingStorage(userId));
        await writeCookingStorage(userId, envelope);
        resolveResult(envelope);
      } catch (error) {
        rejectResult(error);
      }
    });
  pendingUpdates.set(key, next);
  void next.finally(() => {
    if (pendingUpdates.get(key) === next) pendingUpdates.delete(key);
  });
  return result;
}
