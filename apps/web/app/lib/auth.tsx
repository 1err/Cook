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
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
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

  const refreshUser = useCallback(async () => {
    const requestGeneration = ++generation.current;
    try {
      const res = await apiFetch("/auth/me");
      if (requestGeneration !== generation.current) return;
      if (res.status === 200) {
        const data = await res.json();
        if (requestGeneration !== generation.current) return;
        bindUserStorage(data.id);
        setUser({
          id: data.id,
          email: data.email,
          is_library_public: Boolean(data.is_library_public),
          is_admin: data.is_admin === true,
        });
      } else {
        // Stale cookie (e.g. user id from another DB) still sends a valid JWT; backend returns 401.
        if (res.status === 401) {
          clearUserStorage();
          await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
        }
        if (requestGeneration === generation.current) setUser(null);
      }
    } catch {
      if (requestGeneration === generation.current) setUser(null);
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const logoutGeneration = ++generation.current;
    clearUserStorage();
    setUser(null);
    setLoading(false);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors
    } finally {
      if (generation.current === logoutGeneration) {
        clearUserStorage();
        router.push("/login");
      }
    }
  }, [router]);

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
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    function expire(broadcast = true) {
      generation.current += 1;
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
      setLoading(true);
      void refreshUser();
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
    <AuthContext.Provider value={{ user, loading, refreshUser, logout, setLibraryVisibility }}>
      {children}
    </AuthContext.Provider>
  );
}
