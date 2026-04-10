import { getApiBase } from "../config";

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const { headers, body, ...rest } = options;
  const isFormData = body instanceof FormData;

  const res = await fetch(`${getApiBase()}${path}`, {
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(headers || {}),
    },
    body,
    ...rest,
  });

  if (res.status === 401 && typeof window !== "undefined") {
    const pathname = window.location.pathname;
    if (pathname !== "/login" && pathname !== "/register") {
      const redirect = `${window.location.pathname}${window.location.search || ""}`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
    }
  }

  return res;
}
