"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth";
import { isAdminUser } from "../lib/admin";
import { NavAuth } from "./NavAuth";

export function Header() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hideHeader = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (hideHeader) {
    return null;
  }

  const isActive = (href: string, alsoActive?: string) =>
    pathname === href || (alsoActive != null && pathname === alsoActive);

  const isLogoActive = pathname === "/" || pathname === "/import";
  const logoHref = user ? "/library" : "/login";
  const showPreview = isAdminUser(user);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__left">
          <Link href={logoHref} className="app-header__brand" aria-label="Home">
            <span className="app-header__mark" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M8 3v18M16 3v18M4 8h16M4 16h16"
                  stroke="white"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className={`font-headline app-header__logo-text${isLogoActive ? " is-active" : ""}`}>
              Cooking
            </span>
          </Link>
          {user ? (
            <>
              <button
                type="button"
                className="app-header__menu-button"
                aria-expanded={mobileMenuOpen}
                aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                onClick={() => setMobileMenuOpen((open) => !open)}
              >
                <span className="material-symbols-outlined">{mobileMenuOpen ? "close" : "menu"}</span>
              </button>
              <nav className={`app-header__nav${mobileMenuOpen ? " is-open" : ""}`} aria-label="Main">
                <Link href="/library" className={`headerNavLink${isActive("/library") ? " is-active" : ""}`}>
                  Library
                </Link>
                <Link href="/planner" className={`headerNavLink${isActive("/planner") ? " is-active" : ""}`}>
                  Planner
                </Link>
                <Link href="/shopping-list" className={`headerNavLink${isActive("/shopping-list") ? " is-active" : ""}`}>
                  Shopping list
                </Link>
                <Link href="/import" className={`headerNavLink${isActive("/import") ? " is-active" : ""}`}>
                  Import
                </Link>
                {showPreview ? (
                  <Link href="/preview" className={`headerNavLink${isActive("/preview") ? " is-active" : ""}`}>
                    Preview
                  </Link>
                ) : null}
              </nav>
            </>
          ) : null}
        </div>
        <NavAuth />
      </div>
    </header>
  );
}
