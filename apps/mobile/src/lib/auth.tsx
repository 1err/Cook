import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { ApiError } from "@cooking/api-client";
import { buildClient } from "./api";
import { clearUserScopedPersistent, ephemeral } from "./storage";
import { cancelAllCookingNotifications } from "../features/cook/notifications";

const TOKEN_KEY = "cooking-mobile-token";

type MobileUser = {
  id: string;
  email: string;
  is_library_public: boolean;
  email_verified?: boolean;
};

type AuthContextValue = {
  token: string | null;
  user: MobileUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  invalidateToken: (rejectedToken: string) => void;
  setLibraryVisibility: (isPublic: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const generation = useRef(0);
  const tokenWrites = useRef<Promise<void>>(Promise.resolve());
  const accountClears = useRef<Promise<void>>(Promise.resolve());

  const persistToken = useCallback((next: string | null) => {
    const write = tokenWrites.current.catch(() => {}).then(async () => {
      if (next) {
        await SecureStore.setItemAsync(TOKEN_KEY, next);
      } else {
        try {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
        } catch {
          // An empty tombstone also prevents a stale credential being restored.
          await SecureStore.setItemAsync(TOKEN_KEY, "");
        }
      }
    });
    tokenWrites.current = write;
    return write;
  }, []);

  const clearAccountData = useCallback((preserveCooking = false) => {
    // A new login waits behind earlier cleanup, so an old account's delayed
    // storage/notification cleanup cannot erase the next account's data.
    const cleanup = accountClears.current.catch(() => {}).then(async () => {
      ephemeral.clear();
      await Promise.allSettled([cancelAllCookingNotifications(), clearUserScopedPersistent({ preserveCooking })]);
    });
    accountClears.current = cleanup;
    return cleanup;
  }, []);

  const clearSession = useCallback(async () => {
    generation.current += 1;
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setLoading(false);
    await Promise.all([persistToken(null), clearAccountData()]);
  }, [clearAccountData, persistToken]);

  const finishAccountAction = useCallback(async (action: "logout" | "logoutAll" | "deleteAccount", password = "") => {
    const requestGeneration = ++generation.current;
    const requestToken = tokenRef.current;
    if (requestToken) {
      // Do not invalidate local state on a failed mutation. In particular a
      // wrong deletion password or offline revocation must retain the account.
      const client = buildClient(requestToken);
      const response = action === "deleteAccount"
        ? await client.auth.deleteAccount(password)
        : await client.auth[action]();
      if (!response.ok) throw new Error("Account request was not confirmed");
    } else if (action !== "logout") {
      throw new Error("Not signed in");
    }
    if (generation.current !== requestGeneration || tokenRef.current !== requestToken) return;
    await clearSession();
  }, [clearSession]);

  const logout = useCallback(() => finishAccountAction("logout"), [finishAccountAction]);
  const logoutAll = useCallback(() => finishAccountAction("logoutAll"), [finishAccountAction]);
  const deleteAccount = useCallback((password: string) => finishAccountAction("deleteAccount", password), [finishAccountAction]);

  const invalidateToken = useCallback((rejectedToken: string) => {
    if (tokenRef.current !== rejectedToken) return;
    // Auth state clears synchronously; a platform storage failure cannot resurrect the UI.
    void clearSession().catch(() => {});
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const requestToken = tokenRef.current;
    const requestGeneration = generation.current;
    if (!requestToken) throw new Error("Not signed in");
    const me = await buildClient(requestToken, () => invalidateToken(requestToken)).auth.me();
    if (tokenRef.current !== requestToken || generation.current !== requestGeneration) return;
    setUser(me);
  }, [invalidateToken]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapGeneration = generation.current;
    async function bootstrap() {
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!savedToken) return;
        const client = buildClient(savedToken);
        const me = await client.auth.me();
        if (cancelled || bootstrapGeneration !== generation.current) return;
        tokenRef.current = savedToken;
        setToken(savedToken);
        setUser(me);
      } catch (error) {
        if (cancelled || bootstrapGeneration !== generation.current) return;
        if (error instanceof ApiError && error.status === 401) {
          await Promise.allSettled([persistToken(null), clearAccountData()]);
        }
        if (cancelled || bootstrapGeneration !== generation.current) return;
        tokenRef.current = null;
        setToken(null);
        setUser(null);
      } finally {
        if (!cancelled && bootstrapGeneration === generation.current) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clearAccountData, persistToken]);

  const login = useCallback(async (email: string, password: string) => {
    const loginGeneration = ++generation.current;
    const client = buildClient(null);
    const res = await client.auth.login(email, password);
    if (loginGeneration !== generation.current) return;
    if (!res.access_token) throw new Error("Token missing from login response");
    await clearAccountData(true);
    if (loginGeneration !== generation.current) return;
    await persistToken(res.access_token);
    if (loginGeneration !== generation.current) return;
    tokenRef.current = res.access_token;
    setToken(res.access_token);
    setUser({ id: res.id, email: res.email, is_library_public: res.is_library_public, email_verified: res.email_verified });
  }, [clearAccountData, persistToken]);

  const register = useCallback(async (email: string, password: string) => {
    const registerGeneration = ++generation.current;
    const client = buildClient(null);
    const res = await client.auth.register(email, password);
    if (registerGeneration !== generation.current) return;
    if (!res.access_token) throw new Error("Token missing from register response");
    await clearAccountData(true);
    if (registerGeneration !== generation.current) return;
    await persistToken(res.access_token);
    if (registerGeneration !== generation.current) return;
    tokenRef.current = res.access_token;
    setToken(res.access_token);
    setUser({ id: res.id, email: res.email, is_library_public: res.is_library_public, email_verified: res.email_verified });
  }, [clearAccountData, persistToken]);

  const setLibraryVisibility = useCallback(
    async (isPublic: boolean) => {
      if (!token) throw new Error("Not signed in");
      const client = buildClient(token, () => invalidateToken(token));
      const res = await client.auth.setLibraryVisibility(isPublic);
      if (tokenRef.current !== token) return;
      setUser((prev) =>
        prev ? { ...prev, is_library_public: res.is_library_public } : prev,
      );
    },
    [invalidateToken, token],
  );

  const value = useMemo(
    () => ({ token, user, loading, login, register, logout, logoutAll, deleteAccount, refreshUser, invalidateToken, setLibraryVisibility }),
    [deleteAccount, invalidateToken, loading, login, logout, logoutAll, refreshUser, register, setLibraryVisibility, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used in AuthProvider");
  return context;
}
