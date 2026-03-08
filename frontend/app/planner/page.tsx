"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import type { Recipe } from "../types";
import { getWeekBounds, getPrevNextWeek, formatWeekLabel } from "../lib/week";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOTS = ["breakfast", "lunch", "dinner"] as const;
type MealType = (typeof SLOTS)[number];

/** Normalize recipe_ids to exactly 3 elements: [breakfast, lunch, dinner]. Use "" for empty. */
function normalizeSlots(recipeIds: string[]): [string, string, string] {
  const [a = "", b = "", c = ""] = recipeIds;
  return [a, b, c];
}

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const name = DAY_NAMES[day === 0 ? 6 : day - 1];
  return `${name} ${m}/${d}`;
}

function PlannerPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const { start, end, dates, weekParam: currentWeek } = getWeekBounds(weekParam);
  const { prev, next } = getPrevNextWeek(currentWeek);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [planByDate, setPlanByDate] = useState<Record<string, [string, string, string]>>({});
  const [loading, setLoading] = useState(true);
  const [draggingSlot, setDraggingSlot] = useState<{ date: string; slot: MealType } | null>(null);

  const fetchPlans = async () => {
    const res = await apiFetch(`/meal-plan?start=${start}&end=${end}`);
    if (!res.ok) return;
    const plans: { date: string; recipe_ids: string[] }[] = await res.json();
    const nextPlan: Record<string, [string, string, string]> = {};
    plans.forEach((p) => {
      nextPlan[p.date] = normalizeSlots(p.recipe_ids);
    });
    dates.forEach((d) => {
      if (!nextPlan[d]) nextPlan[d] = ["", "", ""];
    });
    setPlanByDate(nextPlan);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [plansRes, recipesRes] = await Promise.all([
          apiFetch(`/meal-plan?start=${start}&end=${end}`),
          apiFetch("/recipes"),
        ]);
        if (!recipesRes.ok) throw new Error("Failed to load recipes");
        const recs: Recipe[] = await recipesRes.json();
        if (!cancelled) setRecipes(recs);
        if (plansRes.ok) {
          const plans: { date: string; recipe_ids: string[] }[] = await plansRes.json();
          const nextPlan: Record<string, [string, string, string]> = {};
          plans.forEach((p) => {
            nextPlan[p.date] = normalizeSlots(p.recipe_ids);
          });
          dates.forEach((d) => {
            if (!nextPlan[d]) nextPlan[d] = ["", "", ""];
          });
          if (!cancelled) setPlanByDate(nextPlan);
        }
      } catch {
        if (!cancelled) setRecipes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [start, end, dates.join(",")]);

  async function putDay(date: string, slots: [string, string, string]) {
    const res = await apiFetch(`/meal-plan/${date}`, {
      method: "PUT",
      body: JSON.stringify({ recipe_ids: slots }),
    });
    if (!res.ok) return;
    const updated: { date: string; recipe_ids: string[] } = await res.json();
    setPlanByDate((prev) => ({
      ...prev,
      [date]: normalizeSlots(updated.recipe_ids),
    }));
  }

  function handleDragStart(e: React.DragEvent, recipeId: string) {
    e.dataTransfer.setData("recipeId", recipeId);
    e.dataTransfer.effectAllowed = "copy";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    const date = e.currentTarget.dataset.date;
    const slotIndex = e.currentTarget.dataset.slotIndex;
    if (date !== undefined && slotIndex !== undefined) {
      setDraggingSlot({ date, slot: SLOTS[Number(slotIndex)] });
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.stopPropagation();
    setDraggingSlot(null);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDraggingSlot(null);
    const date = e.currentTarget.dataset.date;
    const slotIndexRaw = e.currentTarget.dataset.slotIndex;
    if (date === undefined || slotIndexRaw === undefined) return;
    const slotIndex = Number(slotIndexRaw);
    if (Number.isNaN(slotIndex) || slotIndex < 0 || slotIndex > 2) return;
    const recipeId = e.dataTransfer.getData("recipeId");
    if (!recipeId) return;
    const current = planByDate[date] ?? ["", "", ""];
    const next: [string, string, string] = [...current];
    next[slotIndex] = recipeId;
    setPlanByDate((prev) => ({ ...prev, [date]: next }));
    await putDay(date, next);
  }

  async function removeMeal(date: string, slotIndex: number) {
    const current = planByDate[date] ?? ["", "", ""];
    const next: [string, string, string] = [...current];
    next[slotIndex] = "";
    setPlanByDate((prev) => ({ ...prev, [date]: next }));
    await putDay(date, next);
  }

  const recipeById: Record<string, Recipe> = {};
  recipes.forEach((r) => (recipeById[r.id] = r));

  function setWeek(week: string) {
    router.push(`/planner?week=${week}`);
  }

  if (loading) return <p style={mutedStyle}>Loading…</p>;

  return (
    <div style={pageStyle}>
      <div style={headerRowStyle}>
        <h1 style={h1Style}>Weekly Meal Planner</h1>
        <div style={weekNavStyle}>
          <button type="button" onClick={() => setWeek(prev)} style={navButtonStyle} aria-label="Previous week">
            ← Prev
          </button>
          <span style={weekBadgeStyle}>{formatWeekLabel(start, end)}</span>
          <button type="button" onClick={() => setWeek(next)} style={navButtonStyle} aria-label="Next week">
            Next →
          </button>
        </div>
      </div>
      <p style={mutedStyle}>
        Drag recipes from the list into a meal slot. Click a planned meal to remove it.
      </p>

      <div style={twoColStyle}>
        <aside style={leftPanelStyle}>
          <h2 style={panelTitleStyle}>Recipes</h2>
          <ul style={recipeListStyle}>
            {recipes.map((r) => (
              <li
                key={r.id}
                draggable
                onDragStart={(e) => handleDragStart(e, r.id)}
                style={draggableCardStyle}
              >
                <div style={miniThumbStyle}>
                  {r.thumbnail_url ? (
                    <img src={r.thumbnail_url} alt="" style={miniThumbImgStyle} />
                  ) : (
                    <div style={miniPlaceholderStyle} />
                  )}
                </div>
                <span style={miniTitleStyle}>{r.title}</span>
              </li>
            ))}
          </ul>
          {recipes.length === 0 && (
            <p style={mutedStyle}>
              <Link href="/import" style={linkStyle}>Import recipes</Link> to add them here.
            </p>
          )}
        </aside>

        <div style={gridWrapStyle}>
          <div style={gridTableStyle}>
            <div style={gridCellStyle} />
            {SLOTS.map((s) => (
              <div key={s} style={gridCellStyle}>
                <span style={slotLabelStyle}>{s}</span>
              </div>
            ))}
            {dates.flatMap((date) => {
              const row: React.ReactNode[] = [
                <div key={`${date}-day`} style={gridCellStyle}>
                  <strong style={dayLabelStyle}>{formatDayLabel(date)}</strong>
                </div>,
              ];
              SLOTS.forEach((slot, slotIndex) => {
                const recipeId = (planByDate[date] ?? ["", "", ""])[slotIndex];
                const recipe = recipeId ? recipeById[recipeId] : null;
                const isHighlight = draggingSlot?.date === date && draggingSlot?.slot === slot;
                row.push(
                  <div
                    key={`${date}-${slotIndex}`}
                    data-date={date}
                    data-slot-index={String(slotIndex)}
                    style={{
                      ...gridCellStyle,
                      ...slotCellStyle,
                      ...(isHighlight ? slotCellHighlightStyle : {}),
                    }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {recipe ? (
                      <div
                        style={plannedCardStyle}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMeal(date, slotIndex);
                        }}
                        title="Click to remove"
                      >
                        {recipe.thumbnail_url && (
                          <img src={recipe.thumbnail_url} alt="" style={plannedThumbStyle} />
                        )}
                        <span style={plannedTitleStyle}>{recipe.title}</span>
                      </div>
                    ) : (
                      <span style={emptySlotStyle}>Drop here</span>
                    )}
                  </div>
                );
              });
              return row;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlannerPage() {
  return (
    <RequireAuth>
      <div className="app-wide">
        <Suspense fallback={<p style={mutedStyle}>Loading…</p>}>
          <PlannerPageContent />
        </Suspense>
      </div>
    </RequireAuth>
  );
}

const pageStyle: React.CSSProperties = { minWidth: 0 };

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-16)",
  marginBottom: "var(--space-12)",
};

const h1Style: React.CSSProperties = {
  fontSize: "var(--font-title)",
  fontWeight: 600,
  margin: 0,
};

const weekNavStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-12)",
};

const navButtonStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "var(--space-8) var(--space-12)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "0.85rem",
  cursor: "pointer",
};

const weekBadgeStyle: React.CSSProperties = {
  padding: "var(--space-8) var(--space-16)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  fontSize: "var(--font-section)",
  fontWeight: 500,
  color: "var(--text)",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
  marginBottom: "var(--space-24)",
};

const twoColStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "200px 1fr",
  gap: "var(--space-24)",
  alignItems: "start",
};

const leftPanelStyle: React.CSSProperties = {
  position: "sticky",
  top: "var(--space-24)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  padding: "var(--space-16)",
  boxShadow: "var(--shadow-card)",
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: "var(--font-section)",
  fontWeight: 600,
  marginBottom: "var(--space-12)",
};

const recipeListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-8)",
};

const draggableCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-8)",
  padding: "var(--space-8)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  cursor: "grab",
};

const miniThumbStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 6,
  overflow: "hidden",
  flexShrink: 0,
};

const miniThumbImgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const miniPlaceholderStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "var(--border)",
};

const miniTitleStyle: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const linkStyle: React.CSSProperties = { color: "var(--accent)" };

const gridWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  minWidth: 0,
};

/** 4 cols (day + breakfast + lunch + dinner), 8 rows (header + 7 days). Full width. */
const gridTableStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "140px repeat(3, 1fr)",
  gridTemplateRows: "auto repeat(7, minmax(80px, auto))",
  width: "100%",
  gap: 0,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  overflow: "hidden",
  background: "var(--border)",
};

const gridCellStyle: React.CSSProperties = {
  background: "var(--surface)",
  padding: "var(--space-12)",
  border: "1px solid var(--border)",
};

const slotLabelStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 600,
  textTransform: "capitalize",
  color: "var(--muted)",
};

const dayLabelStyle: React.CSSProperties = {
  fontSize: "0.9rem",
};

const slotCellStyle: React.CSSProperties = {
  minHeight: 80,
  transition: "background 0.15s ease",
};

const slotCellHighlightStyle: React.CSSProperties = {
  background: "var(--surface-elevated)",
  outline: "2px solid var(--accent)",
  outlineOffset: -2,
};

const emptySlotStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "0.85rem",
};

const plannedCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-8)",
  padding: "var(--space-8)",
  background: "var(--bg)",
  borderRadius: "var(--radius-btn)",
  cursor: "pointer",
  border: "1px solid transparent",
};

const plannedThumbStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  objectFit: "cover",
  flexShrink: 0,
};

const plannedTitleStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 500,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
