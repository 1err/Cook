"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HomeLanguage } from "./homeContent";
import styles from "./PublicSite.module.css";

const SITE_LINKS = [
  ["/", "Home", "首页"],
  ["/about", "About", "关于"],
  ["/contact", "Contact", "联系"],
  ["/privacy", "Privacy", "隐私"],
  ["/terms", "Terms", "条款"],
] as const;

export function PublicLinks({ compact = false, main = false, language = "en" }: { compact?: boolean; main?: boolean; language?: HomeLanguage }) {
  const pathname = usePathname();
  return (
    <nav aria-label={main ? "Main" : "Site information"} lang={language === "zh" ? "zh-CN" : "en"} className={main ? styles.headerLinks : compact ? styles.compactLinks : styles.footerLinks}>
      {SITE_LINKS.map(([href, english, chinese]) => (
        <Link aria-current={pathname === href ? "page" : undefined} href={href} key={href}>{language === "zh" ? chinese : english}</Link>
      ))}
    </nav>
  );
}

export function PublicShell({ children, language = "en", onLanguageChange }: { children: ReactNode; language?: HomeLanguage; onLanguageChange?: () => void }) {
  const appLink = <Link href="/library" className={styles.appLink}>{language === "zh" ? "开始使用" : "Open app"}</Link>;
  return (
    <div className={styles.site} lang={language === "zh" ? "zh-CN" : "en"}>
      <a className={styles.skipLink} href="#main-content">{language === "zh" ? "跳至主要内容" : "Skip to content"}</a>
      <header className={styles.header}>
        <div className={`${styles.headerInner}${onLanguageChange ? ` ${styles.localizedHeader}` : ""}`}>
          <Link href="/" aria-label="Chef World home" className={styles.brand}>
            <img src="/brand/chef-world-mark.svg" alt="" width={36} height={36} />
            <span>Chef World</span>
          </Link>
          <PublicLinks main language={language} />
          {onLanguageChange ? <div className={styles.headerActions}>
            <button type="button" className={styles.languageToggle} aria-label={language === "en" ? "Switch to Chinese" : "切换到英文"} onClick={onLanguageChange}>{language === "en" ? "中文" : "EN"}</button>
            {appLink}
          </div> : appLink}
        </div>
      </header>
      {children}
      <footer className={styles.footer}>
        <div>
          <Link href="/" className={styles.footerBrand}>Chef World<span aria-hidden="true">.</span></Link>
          <p>© 2026 Chef World</p>
        </div>
        <PublicLinks language={language} />
      </footer>
    </div>
  );
}
