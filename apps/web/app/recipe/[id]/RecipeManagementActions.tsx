"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon } from "../../components/ui/Icon";
import { useT } from "../../lib/i18n";
import styles from "./RecipeDetail.module.css";

export function RecipeManagementActions({ id, deleting, disabled, onDelete }: {
  id: string;
  deleting: boolean;
  disabled: boolean;
  onDelete: () => void;
}) {
  const t = useT();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const menu = disclosure.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, []);

  function close() {
    if (disclosure.current) disclosure.current.open = false;
    trigger.current?.focus();
  }

  return (
    <details ref={disclosure} className={styles.moreActions}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault();
          close();
        }
      }}>
      <summary ref={trigger} aria-label={t("common.moreActions")} title={t("common.moreActions")}>
        <Icon name="more" size={19} />
      </summary>
      <div className={styles.moreActionsMenu}>
        <Link href={`/library/${encodeURIComponent(id)}`}>
          <Icon name="edit" size={16} />{t("recipe.editRecipe")}
        </Link>
        <button type="button" disabled={disabled || deleting} onClick={() => { close(); onDelete(); }}>
          <Icon name="trash" size={16} />{t(deleting ? "recipe.deleting" : "common.delete")}
        </button>
      </div>
    </details>
  );
}
