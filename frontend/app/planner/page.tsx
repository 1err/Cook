"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getApiBase } from "../config";
import type { Recipe } from "../types";
import { getWeekBounds, getPrevNextWeek, formatWeekLabel } from "../lib/week";

interface MealPlanDay {
  date: string;
  recipe_ids: string[];
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const name = DAY_NAMES[day === 0 ? 6 : day - 1];
  return `${name} ${m}/${d}`;
}

export default function PlannerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const { start, end, dates, weekParam: currentWeek } = getWeekBounds(weekParam);
  const { prev, next } = getPrevNextWeek(currentWeek);
  const [mealPlans, setMealPlans] = useState<MealPlanDay[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [plansRes, recipesRes] = await Promise.all([
          fetch(`${getApiBase()}/meal-plan?start=${start}&end=${end}`),
          fetch(`${getApiBase()}/recipes`),
        ]);
        if (!plansRes.ok || !recipesRes.ok) throw new Error("Failed to load");
        const plans: MealPlanDay[] = await plansRes.json();
        const recs: Recipe[] = await recipesRes.json();
        if (!cancelled) {
          setMealPlans(plans);
          setRecipes(recs);
        }
      } catch (e) {
        if (!cancelled) setMealPlans([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const planByDate: Record<string, string[]> = {};
  mealPlans.forEach((p) => {
    planByDate[p.date] = p.recipe_ids;
  });

  function openAssign(date: string) {
    setEditingDate(date);
    setSelectedIds(planByDate[date] ?? []);
  }

  function closeAssign() {
    setEditingDate(null);
  }

  function toggleRecipe(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  }

  async function saveAssignment() {
    if (!editingDate) return;
    setSaving(true);
    try {
      const res = await fetch(`${getApiBase()}/meal-plan/${editingDate}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipe_ids: selectedIds }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setMealPlans((prev) => {
        const rest = prev.filter((p) => p.date !== editingDate);
        return [...rest, { date: updated.date, recipe_ids: updated.recipe_ids }].sort(
          (a, b) => a.date.localeCompare(b.date)
        );
      });
      closeAssign();
    } catch (e) {
      // could set error state
    } finally {
      setSaving(false);
    }
  }

  function getTitles(recipeIds: string[]): string[] {
    const byId: Record<string, Recipe> = {};
    recipes.forEach((r) => (byId[r.id] = r));
    return recipeIds.map((id) => byId[id]?.title ?? "(unknown)");
  }

  function setWeek(week: string) {
    router.push(`/planner?week=${week}`);
  }

  if (loading) return <p style={mutedStyle}>Loading…</p>;

  return (
    <div>
      <h1 style={h1Style}>Weekly Meal Planner</h1>
      <div style={weekNavStyle}>
        <button
          type="button"
          onClick={() => setWeek(prev)}
          style={navButtonStyle}
          aria-label="Previous week"
        >
          ← Prev
        </button>
        <span style={weekBadgeStyle}>{formatWeekLabel(start, end)}</span>
        <button
          type="button"
          onClick={() => setWeek(next)}
          style={navButtonStyle}
          aria-label="Next week"
        >
          Next →
        </button>
      </div>
      <p style={mutedStyle}>
        Click a day to assign recipes. Changes are saved to the server.
      </p>

      <div style={gridStyle}>
        {dates.map((date) => {
          const recipeIds = planByDate[date] ?? [];
          const titles = getTitles(recipeIds);
          return (
            <div key={date} style={dayCardStyle}>
              <div style={dayHeaderStyle}>
                <strong style={dayLabelStyle}>{formatDayLabel(date)}</strong>
                <button
                  type="button"
                  onClick={() => openAssign(date)}
                  style={assignButtonStyle}
                >
                  {recipeIds.length ? "Edit" : "Assign"}
                </button>
              </div>
              <ul style={recipeListStyle}>
                {titles.length === 0 ? (
                  <li style={emptyDayStyle}>No recipes</li>
                ) : (
                  titles.map((t, i) => (
                    <li key={i} style={recipeItemStyle}>
                      {t}
                    </li>
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {editingDate && (
        <div style={modalOverlayStyle} onClick={closeAssign}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={modalTitleStyle}>
              Assign recipes — {formatDayLabel(editingDate)}
            </h2>
            <p style={mutedStyle}>Select from your library:</p>
            <ul style={checkboxListStyle}>
              {recipes.map((r) => (
                <li key={r.id} style={checkboxItemStyle}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.id)}
                      onChange={() => toggleRecipe(r.id)}
                    />
                    <span style={{ marginLeft: "0.5rem" }}>{r.title}</span>
                  </label>
                </li>
              ))}
            </ul>
            {recipes.length === 0 && (
              <p style={mutedStyle}>No recipes in library. Add some from Import.</p>
            )}
            <div style={modalActionsStyle}>
              <button
                type="button"
                onClick={saveAssignment}
                disabled={saving}
                style={saveButtonStyle}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={closeAssign} style={cancelButtonStyle}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const h1Style: React.CSSProperties = {
  fontSize: "var(--font-title)",
  fontWeight: 600,
  marginBottom: "var(--space-12)",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "var(--font-body)",
  marginBottom: "var(--space-24)",
};

const weekNavStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-12)",
  marginBottom: "var(--space-24)",
};

const navButtonStyle: React.CSSProperties = {
  minHeight: 36,
  minWidth: 40,
  padding: "var(--space-8) var(--space-12)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--muted)",
  fontSize: "0.8rem",
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

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: "var(--space-16)",
};

const dayCardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  padding: "var(--space-16)",
  boxShadow: "var(--shadow-card)",
};

const dayHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "var(--space-12)",
};

const dayLabelStyle: React.CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: 500,
};

const assignButtonStyle: React.CSSProperties = {
  padding: "var(--space-8) var(--space-12)",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  fontSize: "0.85rem",
  cursor: "pointer",
};

const recipeListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  fontSize: "0.9rem",
};

const recipeItemStyle: React.CSSProperties = {
  padding: "0.2rem 0",
  borderBottom: "1px solid var(--border)",
};

const emptyDayStyle: React.CSSProperties = {
  color: "var(--muted)",
  fontStyle: "italic",
  padding: "0.2rem 0",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10,
};

const modalStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  padding: "var(--space-24)",
  maxWidth: 400,
  width: "90%",
  maxHeight: "80vh",
  overflow: "auto",
};

const modalTitleStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontSize: "1.1rem",
};

const checkboxListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 1rem 0",
  maxHeight: 240,
  overflow: "auto",
};

const checkboxItemStyle: React.CSSProperties = {
  padding: "0.35rem 0",
  cursor: "pointer",
};

const modalActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
};

const saveButtonStyle: React.CSSProperties = {
  padding: "var(--space-12) var(--space-24)",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  borderRadius: "var(--radius-btn)",
  fontWeight: 600,
  cursor: "pointer",
};

const cancelButtonStyle: React.CSSProperties = {
  padding: "var(--space-12) var(--space-24)",
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  color: "var(--text)",
  cursor: "pointer",
};
