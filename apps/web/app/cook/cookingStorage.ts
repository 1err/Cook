import { parseCookingSessionCache, type CookingSessionCacheEnvelope } from "@cooking/shared";

export function cookingStorageKey(userId: string): string {
  return `cookingSession:v1:${userId}`;
}

export function readCookingStorage(userId: string): CookingSessionCacheEnvelope | null {
  try {
    return parseCookingSessionCache(localStorage.getItem(cookingStorageKey(userId)), userId);
  } catch {
    return null;
  }
}

export function writeCookingStorage(userId: string, envelope: CookingSessionCacheEnvelope): void {
  try {
    localStorage.setItem(cookingStorageKey(userId), JSON.stringify(envelope));
  } catch {
    // Cooking remains usable if browser storage is unavailable.
  }
}

export function clearCookingStorage(userId: string): void {
  try {
    localStorage.removeItem(cookingStorageKey(userId));
  } catch {
    // Ignore browser storage failures during logout.
  }
}
