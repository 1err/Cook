import type { ReactNode } from "react";
import styles from "./PageShell.module.css";

type PageShellProps = {
  children: ReactNode;
  className?: string;
  size?: "default" | "narrow";
};

type PageHeaderProps = {
  title: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
};

export function PageShell({ children, className = "", size = "default" }: PageShellProps) {
  return (
    <main
      className={`${styles.shell} ${styles[size]} ${className}`.trim()}
      data-page-shell={size}
    >
      {children}
    </main>
  );
}

export function PageHeader({ title, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.titleGroup}>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1 className={styles.title}>{title}</h1>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
