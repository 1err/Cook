import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { buildClient } from "./api";
import { clearUserScopedPersistent, ephemeral } from "./storage";

const TOKEN_KEY = "cooking-mobile-token";

type MobileUser = {
  id: string;
  email: string;
  is_library_public: boolean;
};

type AuthContextValue = {
  token: string | null;
  user: MobileUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setLibraryVisibility: (isPublic: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!savedToken) return;
        const client = buildClient(savedToken);
        const me = await client.auth.me();
        if (cancelled) return;
        setToken(savedToken);
        setUser(me);
      } catch {
        if (cancelled) return;
        setToken(null);
        setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const client = buildClient(null);
    const res = await client.auth.login(email, password);
    if (!res.access_token) throw new Error("Token missing from login response");
    await SecureStore.setItemAsync(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
    setUser({ id: res.id, email: res.email, is_library_public: res.is_library_public });
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const client = buildClient(null);
    const res = await client.auth.register(email, password);
    if (!res.access_token) throw new Error("Token missing from register response");
    await SecureStore.setItemAsync(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
    setUser({ id: res.id, email: res.email, is_library_public: res.is_library_public });
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    ephemeral.clear();
    await clearUserScopedPersistent();
    setToken(null);
    setUser(null);
  }, []);

  const setLibraryVisibility = useCallback(
    async (isPublic: boolean) => {
      if (!token) throw new Error("Not signed in");
      const client = buildClient(token);
      const res = await client.auth.setLibraryVisibility(isPublic);
      setUser((prev) =>
        prev ? { ...prev, is_library_public: res.is_library_public } : prev,
      );
    },
    [token],
  );

  const value = useMemo(
    () => ({ token, user, loading, login, register, logout, setLibraryVisibility }),
    [loading, login, logout, register, setLibraryVisibility, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used in AuthProvider");
  return context;
}
