const envApiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";

/**
 * Backend API base URL for fetch calls. Use this in client-side code so that:
 * - On localhost / 127.0.0.1 we use http://localhost:8000 (or 127.0.0.1:8000).
 * - On other hosts (e.g. phone at http://192.168.1.178:3000) we use NEXT_PUBLIC_API_BASE.
 * - When unset and not localhost, same-origin (empty string) for deployed app.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return `http://${h}:8000`;
  }
  return envApiBase;
}

/** @deprecated Use getApiBase() so localhost works without changing .env */
export const API_BASE = envApiBase;
