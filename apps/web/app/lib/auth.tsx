"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "./api";
import { AUTH_EXPIRED_EVENT, AUTH_USER_STORAGE_KEY, bindUserStorage, clearUserStorage } from "./userStorage";

export type AuthUser = {
  id: string;
  email: string;
  is_library_public: boolean;
  is_admin?: boolean;
  email_verified?: boolean;
  email_verification_required?: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refreshUser: (options?: { newSession?: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  setLibraryVisibility: (isPublic: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const accountGeneration = useRef(0);
  const activeUserId = useRef<string | null>(null);

  const refreshUser = useCallback(async (options?: { newSession?: boolean }) => {
    if (options?.newSession) {
      accountGeneration.current += 1;
      activeUserId.current = null;
      clearUserStorage();
      setUser(null);
      setLoading(true);
    }
    const requestGeneration = ++generation.current;
    try {
      const res = await apiFetch("/auth/me");
      if (requestGeneration !== generation.current) return;
      if (res.status === 200) {
        const data = await res.json();
        if (requestGeneration !== generation.current) return;
        if (activeUserId.current !== data.id) accountGeneration.current += 1;
        activeUserId.current = data.id;
        bindUserStorage(data.id);
        setUser({
          id: data.id,
          email: data.email,
          is_library_public: Boolean(data.is_library_public),
          is_admin: data.is_admin === true,
          email_verified: data.email_verified === true,
          email_verification_required: data.email_verification_required === true,
        });
      } else if (res.status === 401) {
        // Stale cookie (e.g. user id from another DB) still sends a valid JWT; backend returns 401.
        clearUserStorage();
        accountGeneration.current += 1;
        activeUserId.current = null;
        if (requestGeneration === generation.current) setUser(null);
      } else {
        throw Object.assign(new Error("Couldn't refresh account"), { status: res.status });
      }
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, []);

  const finishAccountAction = useCallback(async (path: string, options: RequestInit) => {
    const requestGeneration = accountGeneration.current;
    const response = await apiFetch(path, options);
    if (!response.ok) {
      throw Object.assign(new Error("Account action failed"), { status: response.status });
    }
    if (accountGeneration.current !== requestGeneration) return;
    generation.current += 1;
    accountGeneration.current += 1;
    activeUserId.current = null;
    clearUserStorage();
    setUser(null);
    setLoading(false);
    router.push("/login");
  }, [router]);
  const logout = useCallback(() => finishAccountAction("/auth/logout", { method: "POST" }), [finishAccountAction]);
  const logoutAll = useCallback(() => finishAccountAction("/auth/logout-all", { method: "POST" }), [finishAccountAction]);
  const deleteAccount = useCallback((password: string) => finishAccountAction("/auth/account", {
    method: "DELETE", body: JSON.stringify({ password }),
  }), [finishAccountAction]);

  const setLibraryVisibility = useCallback(async (isPublic: boolean) => {
    const requestGeneration = generation.current;
    const res = await apiFetch("/auth/library-visibility", {
      method: "POST",
      body: JSON.stringify({ is_public: isPublic }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (requestGeneration !== generation.current) return;
    setUser((prev) =>
      prev ? { ...prev, is_library_public: Boolean(data.is_library_public) } : prev,
    );
  }, []);

  useEffect(() => {
    void refreshUser().catch(() => {});
  }, [refreshUser]);

  useEffect(() => {
    function expire(broadcast = true) {
      generation.current += 1;
      accountGeneration.current += 1;
      activeUserId.current = null;
      clearUserStorage({ broadcast });
      setUser(null);
      setLoading(false);
    }
    function syncAccount(event: StorageEvent) {
      if (event.key !== AUTH_USER_STORAGE_KEY) return;
      try {
        if (localStorage.getItem(AUTH_USER_STORAGE_KEY) !== event.newValue) return;
      } catch { /* Continue with the received event when storage is unavailable. */ }
      if (event.newValue === null) {
        expire(false);
        return;
      }
      if (event.newValue !== activeUserId.current) expire(false);
      setLoading(true);
      void refreshUser().catch(() => {});
    }
    const handleExpired = () => expire();
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    window.addEventListener("storage", syncAccount);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
      window.removeEventListener("storage", syncAccount);
    };
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, logout, logoutAll, deleteAccount, setLibraryVisibility }}>
      {children}
    </AuthContext.Provider>
  );
}
