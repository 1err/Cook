import type { StoreProductsBatchResponse, StoreProductsResponse } from "./index";

const MAX_TTL_MS = 86_400_000;

function timestamp(value: unknown): number {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error("Invalid product clock metadata");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid product clock metadata");
  return parsed;
}

/** Translate wire expiries once, before validation and local persistence. */
export function normalizeStoreProductResponse<T extends StoreProductsResponse | StoreProductsBatchResponse>(
  response: T,
  requestStartedAtMs: number,
): T {
  // Old servers remain compatible and retain the existing strict validation.
  if (!response || typeof response !== "object" || !("server_time" in response)) return response;
  const serverTimeMs = timestamp(response.server_time);
  const receivedAtMs = Date.now();
  if (!Number.isFinite(requestStartedAtMs) || requestStartedAtMs > receivedAtMs) {
    throw new Error("Invalid product request clock");
  }
  const localExpiry = (expiresAt: string | null): string | null => {
    if (expiresAt === null) return null;
    const remainingMs = timestamp(expiresAt) - serverTimeMs;
    // Anchor at request start, not receipt: network/JSON latency may shorten
    // freshness, but must never extend it. No clock-skew grace period is added.
    const expiresAtMs = requestStartedAtMs + remainingMs;
    if (remainingMs <= 0 || remainingMs > MAX_TTL_MS || expiresAtMs <= receivedAtMs) {
      throw new Error("Expired product response");
    }
    return new Date(expiresAtMs).toISOString();
  };
  const { server_time: _serverTime, ...local } = response as StoreProductsResponse | StoreProductsBatchResponse;
  if ("entries" in local) {
    if (!Array.isArray(local.entries)) throw new Error("Invalid product batch");
    return { ...local, entries: local.entries.map((entry) => {
      try {
        return { ...entry, expires_at: localExpiry(entry.expires_at) };
      } catch {
        // A stale/invalid hit becomes a miss without discarding other hits.
        return { ...entry, status: "missing" as const, products: [], expires_at: null };
      }
    }) } as T;
  }
  return { ...local, expires_at: localExpiry(local.expires_at) } as T;
}
