"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "./api";
import { clearCookingStorage } from "../cook/cookingStorage";

export type AuthUser = {
  id: string;
  email: string;
  is_library_public: boolean;
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

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch("/auth/me");
      if (res.status === 200) {
        const data = await res.json();
        setUser({
          id: data.id,
          email: data.email,
          is_library_public: Boolean(data.is_library_public),
        });
      } else {
        // Stale cookie (e.g. user id from another DB) still sends a valid JWT; backend returns 401.
        if (res.status === 401) {
          await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
        }
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const userId = user?.id;
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors
    } finally {
      if (userId) clearCookingStorage(userId);
      setUser(null);
      router.push("/login");
    }
  }, [router, user?.id]);

  const setLibraryVisibility = useCallback(async (isPublic: boolean) => {
    const res = await apiFetch("/auth/library-visibility", {
      method: "POST",
      body: JSON.stringify({ is_public: isPublic }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    setUser((prev) =>
      prev ? { ...prev, is_library_public: Boolean(data.is_library_public) } : prev,
    );
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser, logout, setLibraryVisibility }}>
      {children}
    </AuthContext.Provider>
  );
}
