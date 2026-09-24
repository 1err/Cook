"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth";
import { trackEvent } from "../lib/analytics";

export function AnalyticsTracker() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const last = useRef("");
  useEffect(() => {
    const key = `${pathname}:${user?.id || "anonymous"}`;
    if (!loading && pathname && last.current !== key) {
      last.current = key;
      trackEvent("page_view", pathname);
    }
  }, [pathname, loading, user?.id]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest?.("a[href]");
      if (!a) return;
      try {
        const host = new URL((a as HTMLAnchorElement).href).hostname;
        if (host === "sayweee.com" || host.endsWith(".sayweee.com"))
          trackEvent("retailer_handoff", window.location.pathname, "weee");
        if (host === "instacart.com" || host.endsWith(".instacart.com"))
          trackEvent("retailer_handoff", window.location.pathname, "instacart");
      } catch {}
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
