import { getApiBase } from "../config";

type Context = {
  visitor_id: string;
  session_id: string;
  last: number;
  expires: number;
  source?: string;
  medium?: string;
  campaign?: string;
  referrer?: string;
};
const KEY = "cw.analytics.v1";
export function safeCampaign(value: string | null) {
  return value && /^[A-Za-z0-9 _.-]{1,64}$/.test(value) ? value : undefined;
}
function optedOut() {
  return (
    typeof window === "undefined" ||
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  );
}

export function analyticsContext(touch = false): Context | null {
  if (optedOut()) return null;
  try {
    const now = Date.now();
    const saved = JSON.parse(
      localStorage.getItem(KEY) || "null",
    ) as Context | null;
    const valid =
      saved &&
      saved.expires > now &&
      typeof saved.visitor_id === "string" &&
      typeof saved.session_id === "string";
    const expired = !valid || now - saved.last > 30 * 60 * 1000;
    if (!touch && expired) return null;
    const params = new URLSearchParams(window.location.search);
    let referrer: string | undefined;
    try {
      const url = new URL(document.referrer);
      if (url.hostname !== window.location.hostname) referrer = url.origin;
    } catch {}
    const context: Context = expired
      ? {
          visitor_id: valid ? saved.visitor_id : crypto.randomUUID(),
          session_id: crypto.randomUUID(),
          last: now,
          expires: valid ? saved.expires : now + 90 * 86400000,
          source: safeCampaign(params.get("utm_source")),
          medium: safeCampaign(params.get("utm_medium")),
          campaign: safeCampaign(params.get("utm_campaign")),
          referrer,
        }
      : { ...saved, last: touch ? now : saved.last };
    if (touch) localStorage.setItem(KEY, JSON.stringify(context));
    return context;
  } catch {
    return null;
  }
}

export function analyticsHeaders(): Record<string, string> {
  try {
    const c = analyticsContext();
    if (!c) return {};
    const h: Record<string, string> = {
      "x-cw-visitor": c.visitor_id,
      "x-cw-session": c.session_id,
      "x-cw-event-id": crypto.randomUUID(),
    };
    for (const k of ["source", "medium", "campaign", "referrer"] as const)
      if (c[k]) h["x-cw-" + k] = c[k]!;
    return h;
  } catch {
    return {};
  }
}

export function trackEvent(
  name: "page_view" | "retailer_handoff",
  path: string,
  retailer?: "weee" | "instacart",
) {
  if (path.startsWith("/admin") || path.startsWith("/preview")) return;
  const c = analyticsContext(true);
  if (!c) return;
  const browser = /Edg\//.test(navigator.userAgent)
    ? "Edge"
    : /Firefox\//.test(navigator.userAgent)
      ? "Firefox"
      : /Chrome\//.test(navigator.userAgent)
        ? "Chrome"
        : /Safari\//.test(navigator.userAgent)
          ? "Safari"
          : "Other";
  const device =
    window.innerWidth <= 640
      ? "mobile"
      : window.innerWidth <= 1024
        ? "tablet"
        : "desktop";
  const { last, expires, ...context } = c;
  try {
    void fetch(`${getApiBase()}/analytics/events`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...context,
        name,
        event_id: crypto.randomUUID(),
        path: path.split("?")[0],
        retailer,
        device,
        browser,
      }),
    }).catch(() => {});
  } catch {}
}
