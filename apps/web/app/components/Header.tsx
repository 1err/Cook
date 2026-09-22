"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { isAdminUser } from "../lib/admin";
import { isPublicPage } from "../lib/publicRoutes";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { isPublicAuthPath } from "../lib/publicAuthPath";
import { AccountMenu } from "./AccountMenu";
import styles from "./Header.module.css";
import { ActionLink } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { Icon } from "./ui/Icon";

const PRIMARY_LINKS = [
  { href: "/library", key: "nav.library", icon: "book" },
  { href: "/planner", key: "nav.planner", icon: "calendar" },
  { href: "/shopping-list", key: "nav.shopping", icon: "shopping" },
  { href: "/cook", key: "nav.cook", icon: "chef" },
] as const;

export function Header() {
  const pathname = usePathname();
  const { loading, logout, user } = useAuth();
  const { t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigationId = useId();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (isPublicPage(pathname) || isPublicAuthPath(pathname)) {
    return null;
  }

  const isActive = (href: string) =>
    pathname === href || (href === "/library" && pathname.startsWith("/library/"));
  const addRecipeHref = `/import?from=${encodeURIComponent(pathname)}`;

  return (
    <header className={styles.header} data-app-shell>
      <div className={styles.inner}>
        <Link
          aria-label={t("nav.appName")}
          className={styles.brand}
          href={user ? "/library" : "/login"}
        >
          <img
            alt=""
            aria-hidden="true"
            className={styles.brandMark}
            height={38}
            src="/brand/chef-world-mark.svg"
            width={38}
          />
          <span aria-hidden="true" className={styles.brandName}>
            {t("nav.appName")}
          </span>
        </Link>

        {!loading && user ? (
          <IconButton
            className={styles.menuButton}
            controls={navigationId}
            expanded={mobileMenuOpen}
            icon={mobileMenuOpen ? "close" : "menu"}
            label={mobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            onClick={() => setMobileMenuOpen((current) => !current)}
          />
        ) : null}

        {user ? (
          <nav
            aria-label="Main"
            className={`${styles.nav}${mobileMenuOpen ? ` ${styles.navOpen}` : ""}`}
            id={navigationId}
          >
            {PRIMARY_LINKS.map((link) => {
              const active = isActive(link.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`${styles.navLink}${active ? ` ${styles.navLinkActive}` : ""}`}
                  href={link.href}
                  key={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className={styles.navIcon} name={link.icon} size={22} />
                  {t(link.key)}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className={styles.actions}>
          {loading ? <span aria-hidden="true" className={styles.accountSkeleton} /> : null}

          {!loading && user ? (
            <>
              <ActionLink
                className={styles.addRecipe}
                href={addRecipeHref}
                leadingIcon="add"
                size="sm"
              >
                {t("nav.addRecipe")}
              </ActionLink>
              <AccountMenu email={user.email} isAdmin={isAdminUser(user)} onLogout={logout} />
            </>
          ) : null}

          {!loading && !user ? (
            <div className={styles.authActions}>
              <ActionLink href="/login" size="sm" variant="ghost">
                {t("nav.signIn")}
              </ActionLink>
              <ActionLink href="/register" size="sm" variant="secondary">
                {t("nav.register")}
              </ActionLink>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
