// Recipe thumbnails uploaded to the local Docker backend get stored with an
// absolute `http://localhost:8000/...` URL (see backend/app/api/routes_recipes.py
// — `f"{request.base_url}{rel}"`). On a phone, "localhost" resolves to the phone
// itself, so the image fetch silently fails. This helper rewrites those local-loopback
// hostnames to the configured API base so the phone hits the Mac instead.
//
// External URLs (e.g. https://img.youtube.com/...) and already-good prod URLs
// (https://api.chef-world.com/...) pass through unchanged.
import { getApiBase } from "../config";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export function resolveImageUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Server-relative ("/uploads/recipes/abc.png") — prefix with API base.
  if (trimmed.startsWith("/")) {
    return `${getApiBase().replace(/\/+$/, "")}${trimmed}`;
  }

  // Try to parse as URL; if not parseable, return as-is.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  // Loopback host → swap origin with API base's origin (preserve path/query).
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    const apiBase = new URL(getApiBase());
    parsed.protocol = apiBase.protocol;
    parsed.host = apiBase.host; // includes port
    return parsed.toString();
  }

  return trimmed;
}
