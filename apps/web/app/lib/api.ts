import { getApiBase } from "../config";
import { createApiClient } from "@cooking/api-client";
import { AUTH_EXPIRED_EVENT, clearUserStorage, getAuthGeneration } from "./userStorage";
import { isPublicAuthPath } from "./publicAuthPath";

export const webApiClient = createApiClient({
  baseUrl: getApiBase(),
  auth: { kind: "cookie" },
  getAuthGeneration,
  onUnauthorized: () => {
    if (typeof window === "undefined") return;
    clearUserStorage();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    const pathname = window.location.pathname;
    if (!isPublicAuthPath(pathname)) {
      const redirect = `${window.location.pathname}${window.location.search || ""}`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
    }
  },
});

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return webApiClient.request(path, options);
}
