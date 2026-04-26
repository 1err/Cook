import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@cooking/api-client";
import { getApiBase } from "../config";

const TOKEN_KEY = "cooking-mobile-token";

type MobileUser = {
  id: string;
  email: string;
};

type AuthContextValue = {
  token: string | null;
  user: MobileUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function buildMobileClient(token: string | null) {
  return createApiClient({
    baseUrl: getApiBase(),
    auth: { kind: "bearer", getToken: () => token },
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!savedToken) return;
        const client = buildMobileClient(savedToken);
        const me = await client.auth.me();
        setToken(savedToken);
        setUser(me);
      } catch {
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    void bootstrap();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const client = buildMobileClient(null);
    const res = await client.auth.login(email, password);
    if (!res.access_token) throw new Error("Token missing from login response");
    await SecureStore.setItemAsync(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
    setUser({ id: res.id, email: res.email });
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const client = buildMobileClient(null);
    const res = await client.auth.register(email, password);
    if (!res.access_token) throw new Error("Token missing from register response");
    await SecureStore.setItemAsync(TOKEN_KEY, res.access_token);
    setToken(res.access_token);
    setUser({ id: res.id, email: res.email });
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, login, register, logout }),
    [loading, login, logout, register, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used in AuthProvider");
  return context;
}

export function useMobileApiClient() {
  const { token } = useAuth();
  return useMemo(() => buildMobileClient(token), [token]);
}
