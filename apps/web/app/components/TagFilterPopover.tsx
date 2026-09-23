"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import styles from "./TagFilterPopover.module.css";
import { Icon } from "./ui/Icon";
import { useT } from "../lib/i18n";
import {
  CATEGORY_LABELS,
  RECIPE_TAG_GROUPS,
  type LibraryFilterId,
  type RecipeTagSlug,
} from "../lib/recipeCategories";

type TagFilterPopoverProps = {
  value?: LibraryFilterId;
  onChange?: (value: LibraryFilterId) => void;
  values?: RecipeTagSlug[];
  onToggleValue?: (value: RecipeTagSlug) => void;
  onClear?: () => void;
  ariaLabel: string;
  triggerLabel?: string;
  allOptionLabel?: string;
};

export function TagFilterPopover({
  value,
  onChange,
  values,
  onToggleValue,
  onClear,
  ariaLabel,
  triggerLabel,
  allOptionLabel = "All tags",
}: TagFilterPopoverProps) {
  const t = useT();
  const summaryId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 16, top: 80, width: 360, maxHeight: 480 });

  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const triggerElement = triggerRef.current;
      if (!triggerElement || triggerElement.getClientRects().length === 0) {
        setOpen(false);
        return;
      }
      const trigger = triggerElement.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 32);
      const below = window.innerHeight - trigger.bottom - 20;
      const above = trigger.top - 20;
      const openAbove = below < 280 && above > below;
      const maxHeight = Math.min(500, window.innerHeight - 32, Math.max(160, openAbove ? above : below));
      const preferredTop = openAbove ? trigger.top - maxHeight - 8 : trigger.bottom + 8;
      setPosition({
        width, maxHeight,
        left: Math.max(16, Math.min(trigger.left, window.innerWidth - width - 16)),
        top: Math.max(16, Math.min(preferredTop, window.innerHeight - maxHeight - 16)),
      });
    }
    place();
    panelRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const isMultiSelect = Array.isArray(values);
  const selectedValues = values ?? [];

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (!open) return;
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [open]);

  const currentLabel =
    triggerLabel ??
    (isMultiSelect
      ? selectedValues.length === 0
        ? allOptionLabel
        : selectedValues.length === 1
          ? CATEGORY_LABELS[selectedValues[0]]
          : `${selectedValues.length} tags`
      : value === "all" || value == null
        ? allOptionLabel
        : CATEGORY_LABELS[value]);

  return (
    <div className={`tag-filter-popover ${styles.root}`} ref={rootRef} onKeyDownCapture={(event) => {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }} onBlur={(event) => {
      if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button
        type="button"
        className={`tag-filter-popover__trigger ${styles.trigger}${open ? " is-open" : ""}`}
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        aria-describedby={summaryId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true"><Icon name="filter" size={18} /></span>
        <span id={summaryId}>{currentLabel}</span>
        <span aria-hidden="true"><Icon name="chevronDown" size={18} /></span>
      </button>

      {open ? (
        <div className={`tag-filter-popover__panel ${styles.panel}`} ref={panelRef} role="dialog" aria-label={ariaLabel} tabIndex={-1}
          style={{ position: "fixed", ...position }}>
          <div className={styles.heading}>
            <strong>{t("recipe.filters.title")}</strong>
            <button type="button" aria-label={t("recipe.filters.close")} onClick={close}><Icon name="close" size={18} /></button>
          </div>
          <div className={styles.scrollBody}>
          <button
            type="button"
            className={`tag-filter-popover__option ${styles.reset}${(!isMultiSelect ? value === "all" : selectedValues.length === 0) ? " is-active" : ""}`}
            aria-pressed={isMultiSelect ? selectedValues.length === 0 : value === "all" || value == null}
            onClick={() => {
              if (isMultiSelect) {
                onClear?.();
              } else {
                onChange?.("all");
              }
              close();
            }}
          >
            {allOptionLabel}
          </button>

          {RECIPE_TAG_GROUPS.map((group) => (
            <div key={group.id} className="tag-filter-popover__group">
              <p className="tag-filter-popover__group-title">{group.label}</p>
              <div className="tag-filter-popover__group-options">
                {group.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`tag-filter-popover__option${isMultiSelect ? " is-multi" : ""}${(isMultiSelect ? selectedValues.includes(tag.id) : value === tag.id) ? " is-active" : ""}`}
                    aria-pressed={isMultiSelect ? selectedValues.includes(tag.id) : value === tag.id}
                    onClick={() => {
                      if (isMultiSelect) {
                        onToggleValue?.(tag.id);
                      } else {
                        onChange?.(tag.id);
                        close();
                      }
                    }}
                  >
                    <span className={styles.check} aria-hidden="true">{(isMultiSelect ? selectedValues.includes(tag.id) : value === tag.id) ? "✓" : ""}</span>
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          </div>
          <div className={styles.footer}><button type="button" onClick={close}>{t("recipe.filters.done")}</button></div>
        </div>
      ) : null}
    </div>
  );
}
