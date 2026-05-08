import AsyncStorage from "@react-native-async-storage/async-storage";

export type StorageBackend = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export const persistent: StorageBackend = {
  get: (key) => AsyncStorage.getItem(key),
  set: async (key, value) => {
    await AsyncStorage.setItem(key, value);
  },
  remove: async (key) => {
    await AsyncStorage.removeItem(key);
  },
};

const memory = new Map<string, string>();
export const ephemeral: StorageBackend & { clear: () => void } = {
  get: async (key) => memory.get(key) ?? null,
  set: async (key, value) => {
    memory.set(key, value);
  },
  remove: async (key) => {
    memory.delete(key);
  },
  clear: () => {
    memory.clear();
  },
};

/**
 * Prefixes of user-scoped keys written to `persistent` (AsyncStorage). When a user
 * logs out, every key matching one of these prefixes is removed so the next user
 * doesn't see stale state. Add to this list whenever a new per-user persistent
 * key is introduced (e.g. saved filters, last-opened recipe).
 */
const USER_SCOPED_PERSISTENT_PREFIXES = [
  "plannerWeekFingerprint:",
];

export async function clearUserScopedPersistent(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const matches = allKeys.filter((k) =>
    USER_SCOPED_PERSISTENT_PREFIXES.some((prefix) => k.startsWith(prefix)),
  );
  if (matches.length > 0) {
    await AsyncStorage.multiRemove(matches);
  }
}

export const json = {
  async get<T>(backend: StorageBackend, key: string): Promise<T | null> {
    const raw = await backend.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async set<T>(backend: StorageBackend, key: string, value: T): Promise<void> {
    await backend.set(key, JSON.stringify(value));
  },
};
