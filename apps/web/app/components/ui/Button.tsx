import Link from "next/link";
import type React from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./Button.module.css";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leadingIcon?: IconName;
};

type ActionLinkProps = React.ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  leadingIcon?: IconName;
  className?: string;
};

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  children,
  className,
  disabled,
  leadingIcon,
  loading = false,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classNames(styles.control, styles[variant], styles[size], className)}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className={styles.spinner} /> : null}
      {leadingIcon ? <Icon name={leadingIcon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ActionLink({
  children,
  className,
  leadingIcon,
  size = "md",
  variant = "primary",
  ...props
}: ActionLinkProps) {
  return (
    <Link {...props} className={classNames(styles.control, styles[variant], styles[size], className)}>
      {leadingIcon ? <Icon name={leadingIcon} /> : null}
      <span>{children}</span>
    </Link>
  );
}

export type { ActionLinkProps, ButtonProps };
