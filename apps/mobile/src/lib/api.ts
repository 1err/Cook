import { useMemo } from "react";
import { createApiClient } from "@cooking/api-client";
import { getApiBase } from "../config";
import { useAuth } from "./auth";

export type ApiClient = ReturnType<typeof createApiClient>;

export function buildClient(token: string | null): ApiClient {
  return createApiClient({
    baseUrl: getApiBase(),
    auth: { kind: "bearer", getToken: () => token },
  });
}

export function useApiClient(): ApiClient {
  const { token } = useAuth();
  return useMemo(() => buildClient(token), [token]);
}
