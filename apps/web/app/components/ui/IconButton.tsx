import type React from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./IconButton.module.css";

type IconButtonProps = {
  icon: IconName;
  label: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean;
  className?: string;
};

export function IconButton({
  className,
  controls,
  disabled = false,
  expanded,
  icon,
  label,
  onClick,
  pressed,
}: IconButtonProps) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      aria-pressed={pressed}
      className={[styles.button, className].filter(Boolean).join(" ")}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} />
    </button>
  );
}

export type { IconButtonProps };
