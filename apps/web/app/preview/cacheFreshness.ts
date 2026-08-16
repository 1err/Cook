export function isStaleUpdatedAt(
  value: string | null,
  ttlMs: number,
  nowMs = Date.now(),
): boolean {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return nowMs - date.getTime() >= ttlMs;
}
