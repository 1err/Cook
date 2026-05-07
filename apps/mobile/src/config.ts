const DEV = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
export const isDev = DEV;

let warnedMissingApiBase = false;
let loggedResolvedApiBase = false;

/**
 * Single source of truth for mobile API base URL.
 *
 * IMPORTANT:
 * - On a physical device, `localhost` points to the phone itself (not your laptop),
 *   so requests to `http://localhost:8000` will fail unless the API is running on the phone.
 * - For real-device testing, set `EXPO_PUBLIC_API_BASE` to your computer's LAN URL,
 *   e.g. `http://192.168.x.x:8000` (do not hardcode this in source).
 */
export function getApiBase(): string {
  const envValue = process.env.EXPO_PUBLIC_API_BASE?.trim();
  const resolvedBase = envValue ? envValue.replace(/\/+$/, "") : "http://localhost:8000";

  if (!envValue && !warnedMissingApiBase) {
    warnedMissingApiBase = true;
    console.warn("EXPO_PUBLIC_API_BASE is not set. API calls may fail on real devices.");
  }

  if (isDev && !loggedResolvedApiBase) {
    loggedResolvedApiBase = true;
    console.info(`[mobile-config] API base: ${resolvedBase}`);
  }

  return resolvedBase;
}
