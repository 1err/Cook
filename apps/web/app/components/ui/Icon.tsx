import type { ReactNode } from "react";

export type IconName =
  | "add"
  | "menu"
  | "close"
  | "account"
  | "settings"
  | "language"
  | "logout"
  | "admin"
  | "chevronDown";

export type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

const SYMBOLS: Record<IconName, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  account: (
    <>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19c.8-3.5 3-5.25 6.5-5.25S17.7 15.5 18.5 19" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.75v2.1M12 19.15v2.1M2.75 12h2.1M19.15 12h2.1M5.46 5.46l1.48 1.48M17.06 17.06l1.48 1.48M18.54 5.46l-1.48 1.48M6.94 17.06l-1.48 1.48" />
    </>
  ),
  language: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.25 2.45 3.4 5.45 3.4 9S14.25 18.55 12 21M12 3C9.75 5.45 8.6 8.45 8.6 12s1.15 6.55 3.4 9" />
    </>
  ),
  logout: (
    <>
      <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3l7 3v5c0 4.6-2.3 7.6-7 10-4.7-2.4-7-5.4-7-10V6l7-3Z" />
      <path d="M9.5 12l1.7 1.7 3.6-3.7" />
    </>
  ),
  chevronDown: <path d="m7 9.5 5 5 5-5" />,
};

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={size}
    >
      {SYMBOLS[name]}
    </svg>
  );
}
