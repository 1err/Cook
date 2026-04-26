import { getApiBase } from "../config";
import { createApiClient } from "@cooking/api-client";

const webApiClient = createApiClient({
  baseUrl: getApiBase(),
  auth: { kind: "cookie" },
});

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await webApiClient.request(path, options);

  if (res.status === 401 && typeof window !== "undefined") {
    const pathname = window.location.pathname;
    if (pathname !== "/login" && pathname !== "/register") {
      const redirect = `${window.location.pathname}${window.location.search || ""}`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
    }
  }

  return res;
}
