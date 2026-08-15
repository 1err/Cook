"use client";

import Link from "next/link";
import { useT } from "../../lib/i18n";

export type PlannerToolbarProps = {
  weekRange: string;
  shoppingHref: string;
  onPrevious: () => void;
  onNext: () => void;
};

export function PlannerToolbar({ weekRange, shoppingHref, onPrevious, onNext }: PlannerToolbarProps) {
  const t = useT();

  return (
    <section className="mb-8 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span
          className="font-headline font-bold text-primary block mb-1 uppercase"
          style={{ fontSize: "0.75rem", letterSpacing: "0.2em" }}
        >
          {weekRange}
        </span>
        <h1
          className="font-headline m-0 text-on-surface"
          style={{
            fontSize: "clamp(2.25rem, 4vw, 3rem)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          {t("planner.title")}
        </h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href={shoppingHref} className="font-bold" style={{ color: "var(--primary)" }}>
          {t("nav.shoppingList")}
        </Link>
        <button
          type="button"
          className="transition-colors border-0 cursor-pointer"
          style={{
            padding: "0.5rem",
            background: "var(--surface-container-low)",
            borderRadius: "9999px",
            color: "var(--on-surface-variant)",
          }}
          onClick={onPrevious}
          aria-label={t("common.previous")}
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <button
          type="button"
          className="transition-colors border-0 cursor-pointer"
          style={{
            padding: "0.5rem",
            background: "var(--surface-container-low)",
            borderRadius: "9999px",
            color: "var(--on-surface-variant)",
          }}
          onClick={onNext}
          aria-label={t("common.next")}
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
    </section>
  );
}
