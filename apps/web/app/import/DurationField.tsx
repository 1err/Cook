"use client";

interface Props {
  seconds: number | null | undefined;
  onChange: (next: number | null) => void;
  ariaLabel: string;
}

export function DurationField({ seconds, onChange, ariaLabel }: Props) {
  const total = seconds ?? 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const update = (nextM: number, nextS: number) => {
    const total = Math.max(0, Math.floor(nextM)) * 60 + Math.max(0, Math.min(59, Math.floor(nextS)));
    onChange(total > 0 ? total : null);
  };
  return (
    <div className="duration-field" role="group" aria-label={ariaLabel}>
      <input
        type="number"
        min={0}
        value={m}
        onChange={(e) => update(Number(e.target.value) || 0, s)}
        aria-label="minutes"
      />
      <span>:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={s.toString().padStart(2, "0")}
        onChange={(e) => update(m, Number(e.target.value) || 0)}
        aria-label="seconds"
      />
    </div>
  );
}
