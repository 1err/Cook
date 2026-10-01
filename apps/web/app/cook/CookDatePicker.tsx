"use client";

import { useEffect, useRef } from "react";
import { Button } from "../components/ui/Button";
import { useI18n, useT } from "../lib/i18n";
import styles from "./CookPage.module.css";

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
function isoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function moveDate(value: string, days: number) {
  const next = localDate(value);
  next.setDate(next.getDate() + days);
  return isoDate(next);
}

export function CookDatePicker({ value, today, onChange }: { value: string; today: string; onChange: (date: string) => void }) {
  const t = useT();
  const { language } = useI18n();
  const selected = useRef<HTMLButtonElement>(null);
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const date = localDate(value);
  const start = moveDate(value, -((date.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, index) => moveDate(start, index));
  useEffect(() => { selected.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [value]);
  return <section className={styles.datePicker} aria-label={t("cook.setup.dateSelection")}>
    <div className={styles.datePickerHeader}>
      <h2>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)}</h2>
      <div className={styles.weekActions}>
        <Button aria-label={t("cook.setup.previousWeek")} variant="ghost" onClick={() => onChange(moveDate(value, -7))}>‹</Button>
        <Button variant="ghost" onClick={() => onChange(today)}>{t("cook.setup.today")}</Button>
        <Button aria-label={t("cook.setup.nextWeek")} variant="ghost" onClick={() => onChange(moveDate(value, 7))}>›</Button>
      </div>
    </div>
    <div className={styles.weekStrip}>
      {days.map(day => <button key={day} type="button" ref={day === value ? selected : undefined}
        aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(localDate(day))}
        aria-pressed={day === value} aria-current={day === today ? "date" : undefined}
        onClick={() => onChange(day)}>
        <span>{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(localDate(day))}</span>
        <strong>{localDate(day).getDate()}</strong>
        <i aria-hidden="true" />
      </button>)}
    </div>
    <label className={styles.dateField}>
      <span>{t("cook.setup.plannedMeal")}</span>
      <input type="date" value={value} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) onChange(event.target.value); }} />
    </label>
  </section>;
}
