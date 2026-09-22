"use client";

import { usePathname } from "next/navigation";

export function ThirdPartyStyles() {
  const pathname = usePathname().replace(/\/$/, "");
  if (["/forgot-password", "/reset-password", "/verify-email"].includes(pathname)) return null;
  return <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap" />;
}
