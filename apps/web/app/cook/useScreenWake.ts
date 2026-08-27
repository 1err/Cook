import { useEffect, useState } from "react";

type WakeSentinel = { release: () => Promise<void> };
type WakeNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeSentinel> } };

export function useScreenWake(enabled: boolean, visible: boolean): { unsupported: boolean } {
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    let sentinel: WakeSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      const wakeLock = (navigator as WakeNavigator).wakeLock;
      if (!wakeLock) {
        setUnsupported(true);
        return;
      }
      if (!enabled || !visible || document.visibilityState === "hidden") return;
      if (sentinel) return;
      try {
        const next = await wakeLock.request("screen");
        if (cancelled) await next.release();
        else sentinel = next;
      } catch {
        setUnsupported(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (sentinel) void sentinel.release();
        sentinel = null;
      } else {
        void acquire();
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (sentinel) void sentinel.release();
    };
  }, [enabled, visible]);
  return { unsupported };
}
