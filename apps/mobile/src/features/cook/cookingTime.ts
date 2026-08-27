export function getRemainingSeconds(deadline: string | null, nowMs = Date.now()): number {
  if (!deadline) return 0;
  const value = Date.parse(deadline);
  return Number.isFinite(value) ? Math.max(0, Math.ceil((value - nowMs) / 1_000)) : 0;
}

export function formatCookingTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}
