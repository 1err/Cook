/** Backend port. Browser always uses same host as the page, this port. */
const API_PORT = 8000;

const envApiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";

/**
 * Backend API base URL for fetch calls.
 *
 * - In the browser: always use the same host as the current page, port 8000.
 *   So if you open http://localhost:3000 or http://192.168.1.5:3000, API is
 *   http://localhost:8000 or http://192.168.1.5:8000. This avoids using
 *   internal hostnames like "backend" that only resolve inside Docker.
 *
 * - On the server (SSR in Docker): window is undefined, so we use
 *   NEXT_PUBLIC_API_BASE (e.g. http://backend:8000 for container-to-container).
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:${API_PORT}`;
  }
  return envApiBase;
}

/** @deprecated Use getApiBase() */
export const API_BASE = envApiBase;
