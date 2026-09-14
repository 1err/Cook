import { useMemo } from "react";
import { createApiClient } from "@cooking/api-client";
import { getApiBase } from "../config";
import { useAuth } from "./auth";

export type ApiClient = ReturnType<typeof createApiClient>;

export function buildClient(token: string | null, onUnauthorized?: () => void): ApiClient {
  return createApiClient({
    baseUrl: getApiBase(),
    auth: { kind: "bearer", getToken: () => token },
    onUnauthorized,
  });
}

export function useApiClient(): ApiClient {
  const { token, invalidateToken } = useAuth();
  return useMemo(() => buildClient(token, () => {
    if (token) invalidateToken(token);
  }), [invalidateToken, token]);
}
