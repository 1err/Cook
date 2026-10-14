"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { Icon } from "./ui/Icon";
import { LanguageControl } from "./LanguageControl";
import styles from "./AccountMenu.module.css";

type AccountMenuProps = {
  email: string;
  isAdmin: boolean;
  onLogout: () => Promise<void>;
};

export function AccountMenu({ email, isAdmin, onLogout }: AccountMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const closeMenu = () => setOpen(false);
  const handleLogout = async () => {
    if (pending) return;
    setPending(true); setLogoutError(false);
    try { await onLogout(); closeMenu(); }
    catch { setLogoutError(true); }
    finally { setPending(false); }
  };
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={t("nav.accountFor", { email })}
        className={styles.trigger}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        title={email}
        type="button"
      >
        {initial}
      </button>

      {open ? (
        <div className={styles.panel} id={panelId}>
          <p className={styles.email} title={email}>
            {email}
          </p>

          <ul className={styles.list}>
            <li>
              <Link className={styles.action} href="/settings" onClick={closeMenu}>
                <Icon name="settings" />
                <span>{t("nav.settings")}</span>
              </Link>
            </li>
            <li className={styles.languageItem}>
              <span className={styles.languageLabel}>
                <Icon name="language" />
                <span>{t("account.language")}</span>
              </span>
              <LanguageControl compact />
            </li>
          </ul>

          {isAdmin ? (
            <section className={styles.adminSection} aria-label={t("nav.adminTools")}>
              <p className={styles.sectionLabel}>{t("nav.adminTools")}</p>
              <ul className={styles.list}>
                <li><Link className={styles.action} href="/moderation" onClick={closeMenu}><Icon name="admin" /><span>{t("safety.moderation")}</span></Link></li>
                <li>
                  <Link className={styles.action} href="/preview" onClick={closeMenu}>
                    <Icon name="admin" />
                    <span>{t("nav.cachePreview")}</span>
                  </Link>
                </li>
                <li>
                  <Link
                    className={styles.action}
                    href="/admin/dashboard"
                    onClick={closeMenu}
                  >
                    <Icon name="admin" />
                    <span>Dashboard</span>
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}

          <div className={styles.logoutSection}>
            <button className={styles.action} onClick={() => void handleLogout()} type="button" disabled={pending}>
              <Icon name="logout" />
              <span>{t("nav.logOut")}</span>
            </button>
            <Link className={`${styles.action} ${styles.deleteAction}`} href="/settings?delete=1#delete-account" onClick={closeMenu}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
              </svg>
              <span>{t("account.deleteTitle")}</span>
            </Link>
            {logoutError ? <p role="alert">{t("account.tryAgain")}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { AccountMenuProps };
