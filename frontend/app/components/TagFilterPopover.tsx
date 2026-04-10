"use client";

import { useEffect, useRef, useState } from "react";
import {
  CATEGORY_LABELS,
  RECIPE_TAG_GROUPS,
  type LibraryFilterId,
} from "../lib/recipeCategories";

type TagFilterPopoverProps = {
  value: LibraryFilterId;
  onChange: (value: LibraryFilterId) => void;
  ariaLabel: string;
};

export function TagFilterPopover({ value, onChange, ariaLabel }: TagFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  const currentLabel = value === "all" ? "All tags" : CATEGORY_LABELS[value];

  return (
    <div className="tag-filter-popover" ref={rootRef}>
      <button
        type="button"
        className={`tag-filter-popover__trigger font-headline${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="material-symbols-outlined">filter_alt</span>
        <span>{currentLabel}</span>
        <span className="material-symbols-outlined">expand_more</span>
      </button>

      {open ? (
        <div className="tag-filter-popover__panel" role="dialog" aria-label={ariaLabel}>
          <button
            type="button"
            className={`tag-filter-popover__option${value === "all" ? " is-active" : ""}`}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            All tags
          </button>

          {RECIPE_TAG_GROUPS.map((group) => (
            <div key={group.id} className="tag-filter-popover__group">
              <p className="tag-filter-popover__group-title font-headline">{group.label}</p>
              <div className="tag-filter-popover__group-options">
                {group.tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`tag-filter-popover__option${value === tag.id ? " is-active" : ""}`}
                    onClick={() => {
                      onChange(tag.id);
                      setOpen(false);
                    }}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
