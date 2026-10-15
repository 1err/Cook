import type { Recipe } from "@cooking/shared";

/** Sum complete, nonblank instructions; incomplete timings stay unspecified. */
export function stepTotalMinutes(steps: Recipe["steps"]): number | null {
  const instructions = steps?.filter(step => step.text.trim()) ?? [];
  if (!instructions.length || instructions.some(step =>
    typeof step.duration_seconds !== "number" || !Number.isFinite(step.duration_seconds) || step.duration_seconds <= 0,
  )) return null;
  return Math.ceil(instructions.reduce((total, step) => total + step.duration_seconds!, 0) / 60);
}
