export const AUTH_USER_STORAGE_KEY = "cooking-auth-user";
export const AUTH_EXPIRED_EVENT = "cooking:auth-expired";

const ACCOUNT_PREFIXES = [
  "smartShoppingList:",
  "smartShoppingProducts:",
  "smartShoppingCart:",
  "plannerWeekFingerprint:",
  "cookingSession:",
];

let activeUserId: string | null = null;
let authGeneration = 0;

export function getAuthGeneration(): number {
  return authGeneration;
}

function browserStores(): { storage: Storage; local: boolean }[] {
  const stores: { storage: Storage; local: boolean }[] = [];
  try { stores.push({ storage: sessionStorage, local: false }); } catch { /* Storage can be disabled. */ }
  try { stores.push({ storage: localStorage, local: true }); } catch { /* Storage can be disabled. */ }
  return stores;
}

function readSessionOwner(): string | null {
  try { return sessionStorage.getItem(AUTH_USER_STORAGE_KEY); } catch { return activeUserId; }
}

function clearCacheRows(previousUserId: string | null, preserveCooking: boolean): void {
  for (const { storage } of browserStores()) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (key && ACCOUNT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          if (key.startsWith("cookingSession:")) {
            if (preserveCooking || !previousUserId || !key.endsWith(`:${previousUserId}`)) continue;
          } else if (key.includes(":user:") && (!previousUserId || !key.endsWith(`:user:${encodeURIComponent(previousUserId)}`))) {
            continue;
          }
          try { storage.removeItem(key); } catch { /* Continue clearing independent keys. */ }
        }
      }
    } catch { /* Account navigation must still work when storage is unavailable. */ }
  }
}

export function clearUserStorage({ broadcast = true } = {}): void {
  authGeneration += 1;
  const previousUserId = readSessionOwner();
  clearCacheRows(previousUserId, false);
  activeUserId = null;
  for (const { storage, local } of browserStores()) {
    try {
      if (!local || (broadcast && storage.getItem(AUTH_USER_STORAGE_KEY) === previousUserId)) {
        storage.removeItem(AUTH_USER_STORAGE_KEY);
      }
    } catch { /* Best effort; namespaced reads cannot inherit an old owner's data. */ }
  }
}

/** Legacy week-only caches are reusable only after this tab verified their account owner. */
export function bindUserStorage(userId: string): void {
  // A status refresh keeps the current session; login/logout/switch invalidates it.
  if (activeUserId !== userId) authGeneration += 1;
  const previous = readSessionOwner();
  if (previous !== userId) clearCacheRows(previous, previous === null);
  activeUserId = userId;
  for (const { storage } of browserStores()) {
    try { storage.setItem(AUTH_USER_STORAGE_KEY, userId); } catch { /* Best effort. */ }
  }
}

function scopedKey(key: string): string {
  return activeUserId ? `${key}:user:${encodeURIComponent(activeUserId)}` : key;
}

/** AuthProvider binds the owner before authenticated children mount. */
export const userSessionStorage = {
  getItem: (key: string) => sessionStorage.getItem(scopedKey(key)),
  setItem: (key: string, value: string) => sessionStorage.setItem(scopedKey(key), value),
  removeItem: (key: string) => sessionStorage.removeItem(scopedKey(key)),
};

export const userLocalStorage = {
  getItem: (key: string) => localStorage.getItem(scopedKey(key)),
  setItem: (key: string, value: string) => localStorage.setItem(scopedKey(key), value),
};
