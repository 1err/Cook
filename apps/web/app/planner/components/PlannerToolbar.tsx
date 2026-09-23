"use client";

import { useT } from "../../lib/i18n";

export type PlannerToolbarProps = {
  weekRange: string;
  onPrevious: () => void;
  onNext: () => void;
};

export function PlannerToolbar({ weekRange, onPrevious, onNext }: PlannerToolbarProps) {
  const t = useT();

  return (
    <section className="planner-toolbar">
      <strong>{weekRange}</strong>
      <div className="planner-toolbar__actions">
        <button type="button" onClick={onPrevious} aria-label={t("common.previous")}>←</button>
        <button type="button" onClick={onNext} aria-label={t("common.next")}>→</button>
      </div>
    </section>
  );
}
