"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth";
import { NavAuth } from "./NavAuth";

export function Header() {
  const pathname = usePathname();
  const { user } = useAuth();

  const navLinkStyle = (href: string, alsoActive?: string) => {
    const isActive = pathname === href || (alsoActive && pathname === alsoActive);
    return { ...baseNavLinkStyle, ...(isActive ? activeNavLinkStyle : {}) };
  };

  const isLogoActive = pathname === "/" || pathname === "/import";
  const logoHref = user ? "/library" : "/login";

  return (
    <header style={headerStyle}>
      <div style={leftStyle}>
        <Link href={logoHref} className="headerNavLink" style={{ ...baseNavLinkStyle, ...(isLogoActive ? activeNavLinkStyle : {}) }}>
          Logo
        </Link>
        {user && (
          <>
            <Link href="/library" className="headerNavLink" style={navLinkStyle("/library")}>
              Library
            </Link>
            <Link href="/planner" className="headerNavLink" style={navLinkStyle("/planner")}>
              Planner
            </Link>
            <Link href="/shopping-list" className="headerNavLink" style={navLinkStyle("/shopping-list")}>
              Shopping List
            </Link>
            <Link href="/import" className="headerNavLink" style={navLinkStyle("/import")}>
              Import
            </Link>
          </>
        )}
      </div>
      <div style={rightStyle}>
        <NavAuth />
      </div>
    </header>
  );
}

const headerStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
  padding: "var(--space-16) var(--space-24)",
  background: "var(--bg)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-16)",
  flexWrap: "wrap",
  minHeight: 52,
};

const leftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-24)",
  flexWrap: "wrap",
  minWidth: 0,
};

const rightStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
};

const baseNavLinkStyle: React.CSSProperties = {
  color: "var(--text)",
  textDecoration: "none",
  fontSize: "0.95rem",
};

const activeNavLinkStyle: React.CSSProperties = {
  color: "var(--accent)",
  fontWeight: 600,
};
