"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { safeAuthRedirect } from "@cooking/shared";

export function AuthSwitchLink({ to, children }: { to: "/login" | "/register"; children: ReactNode }) {
  const [href, setHref] = useState<string>(to);
  useEffect(() => {
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    setHref(redirect ? `${to}?redirect=${encodeURIComponent(safeAuthRedirect(redirect))}` : to);
  }, [to]);
  return <Link href={href} style={{ marginLeft: 4 }}>{children}</Link>;
}
