/**
 * Week bounds for planner and shopping list.
 * URL param: week=YYYY-MM-DD (Monday of that week). If missing, use current week.
 */

export function getWeekBounds(weekMondayParam?: string | null): {
  start: string;
  end: string;
  dates: string[];
  weekParam: string;
} {
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dt = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dt}`;
  };

  let monday: Date;
  if (weekMondayParam && /^\d{4}-\d{2}-\d{2}$/.test(weekMondayParam)) {
    const [y, m, d] = weekMondayParam.split("-").map(Number);
    monday = new Date(y, m - 1, d);
  } else {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  }

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    dates.push(fmt(d));
  }
  return {
    start: dates[0],
    end: dates[6],
    dates,
    weekParam: dates[0],
  };
}

export function getPrevNextWeek(weekMonday: string): { prev: string; next: string } {
  const [y, m, d] = weekMonday.split("-").map(Number);
  const mon = new Date(y, m - 1, d);
  const prev = new Date(mon);
  prev.setDate(mon.getDate() - 7);
  const next = new Date(mon);
  next.setDate(mon.getDate() + 7);
  const fmt = (date: Date) => {
    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  return { prev: fmt(prev), next: fmt(next) };
}

export function formatWeekLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return `${sm}/${sd} – ${em}/${ed}`;
}
