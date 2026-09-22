"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PublicSite.module.css";

const SITE_LINKS = [
  ["/", "Home"],
  ["/about", "About"],
  ["/contact", "Contact"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
] as const;

export function PublicLinks({ compact = false, main = false }: { compact?: boolean; main?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={main ? "Main" : "Site information"} lang="en" className={main ? styles.headerLinks : compact ? styles.compactLinks : styles.footerLinks}>
      {SITE_LINKS.map(([href, label]) => (
        <Link aria-current={pathname === href ? "page" : undefined} href={href} key={href}>{label}</Link>
      ))}
    </nav>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.site} lang="en">
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" aria-label="Chef World home" className={styles.brand}>
            <img src="/brand/chef-world-mark.svg" alt="" width={36} height={36} />
            <span>Chef World</span>
          </Link>
          <PublicLinks main />
          <Link href="/library" className={styles.appLink}>Open app</Link>
        </div>
      </header>
      {children}
      <footer className={styles.footer}>
        <div>
          <Link href="/" className={styles.footerBrand}>Chef World<span aria-hidden="true">.</span></Link>
          <p>© 2026 Chef World</p>
        </div>
        <PublicLinks />
      </footer>
    </div>
  );
}
