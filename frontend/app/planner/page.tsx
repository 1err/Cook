"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import type { Recipe } from "../types";
import { getWeekBounds, getPrevNextWeek, formatWeekPlannerKicker } from "../lib/week";

const COL_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS = ["breakfast", "lunch", "dinner"] as const;
type MealType = (typeof SLOTS)[number];

function normalizeSlots(recipeIds: string[]): [string, string, string] {
  const [a = "", b = "", c = ""] = recipeIds;
  return [a, b, c];
}

function todayYmd(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayOfMonth(dateStr: string): number {
  return Number(dateStr.split("-")[2]);
}

function PlannerPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const { start, end, dates, weekParam: currentWeek } = getWeekBounds(weekParam);
  const { prev, next } = getPrevNextWeek(currentWeek);
  const today = todayYmd();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [planByDate, setPlanByDate] = useState<Record<string, [string, string, string]>>({});
  const [loading, setLoading] = useState(true);
  const [draggingSlot, setDraggingSlot] = useState<{ date: string; slot: MealType } | null>(null);
  const [sideSearch, setSideSearch] = useState("");

  const sidebarRecipes = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => r.title.toLowerCase().includes(q));
  }, [recipes, sideSearch]);

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
    const nextSlots: [string, string, string] = [...current];
    nextSlots[slotIndex] = recipeId;
    setPlanByDate((prev) => ({ ...prev, [date]: nextSlots }));
    await putDay(date, nextSlots);
  }

  async function removeMeal(date: string, slotIndex: number) {
    const current = planByDate[date] ?? ["", "", ""];
    const nextSlots: [string, string, string] = [...current];
    nextSlots[slotIndex] = "";
    setPlanByDate((prev) => ({ ...prev, [date]: nextSlots }));
    await putDay(date, nextSlots);
  }

  const recipeById: Record<string, Recipe> = {};
  recipes.forEach((r) => (recipeById[r.id] = r));

  function setWeek(week: string) {
    router.push(`/planner?week=${week}`);
  }

  if (loading) return <p className="planner-muted app-wide">Loading…</p>;

  return (
    <div className="planner-editorial app-wide" style={{ padding: 0, maxWidth: "100%" }}>
      <aside className="planner-editorial__sidebar">
        <div className="p-6 pb-4 space-y-4">
          <div>
            <h2 className="font-headline m-0 mb-2" style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--on-surface)", letterSpacing: "-0.02em" }}>
              Your saved recipes
            </h2>
            <p className="m-0 text-sm" style={{ color: "var(--on-surface-variant)" }}>
              Drag and drop into your week.
            </p>
          </div>
          <div className="planner-editorial__search">
            <span className="material-symbols-outlined">search</span>
            <input
              type="search"
              placeholder="Search library…"
              value={sideSearch}
              onChange={(e) => setSideSearch(e.target.value)}
              aria-label="Search recipes for planner"
            />
          </div>
        </div>
        <div className="planner-editorial__sidebar-scroll">
          {sidebarRecipes.map((r) => (
            <div
              key={r.id}
              draggable
              onDragStart={(e) => handleDragStart(e, r.id)}
              className="planner-drag-card"
            >
              <div className="planner-drag-card__thumb">
                {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" /> : null}
              </div>
              <div className="planner-drag-card__body">
                <h4 className="planner-drag-card__title font-headline">{r.title}</h4>
              </div>
            </div>
          ))}
          {recipes.length === 0 && (
            <p className="m-0" style={{ fontSize: "0.875rem", color: "var(--on-surface-variant)" }}>
              <Link href="/import" className="font-bold">
                Import recipes
              </Link>{" "}
              to plan your week.
            </p>
          )}
        </div>
        <div className="planner-editorial__sidebar-foot">
          <Link href="/import" className="btn-primary font-headline w-full flex items-center justify-center gap-2" style={{ width: "100%", textDecoration: "none" }}>
            <span className="material-symbols-outlined">add</span>
            New recipe
          </Link>
        </div>
      </aside>

      <main className="planner-editorial__main">
        <section className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="min-w-0">
            <span
              className="font-headline font-bold text-primary block mb-1 uppercase"
              style={{ fontSize: "0.75rem", letterSpacing: "0.2em" }}
            >
              {formatWeekPlannerKicker(start, end)}
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
              Weekly planner
            </h1>
            <p className="m-0 mt-2 text-sm max-w-xl" style={{ color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
              Drag recipes from the sidebar into breakfast, lunch, and dinner.{" "}
              <Link href={`/shopping-list?week=${currentWeek}`} className="font-bold" style={{ color: "var(--primary)" }}>
                Shopping list
              </Link>{" "}
              uses this week&apos;s plan.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              className="transition-colors border-0 cursor-pointer"
              style={{
                padding: "0.5rem",
                background: "var(--surface-container-low)",
                borderRadius: "9999px",
                color: "var(--on-surface-variant)",
              }}
              onClick={() => setWeek(prev)}
              aria-label="Previous week"
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
              onClick={() => setWeek(next)}
              aria-label="Next week"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </section>

        <div className="planner-mobile-tray" aria-label="Recipes to drag">
          <div className="planner-mobile-tray__inner">
            {sidebarRecipes.map((r) => (
              <div
                key={r.id}
                draggable
                onDragStart={(e) => handleDragStart(e, r.id)}
                className="planner-drag-card"
              >
                <div className="planner-drag-card__thumb">
                  {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" /> : null}
                </div>
                <div className="planner-drag-card__body">
                  <h4 className="planner-drag-card__title font-headline">{r.title}</h4>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="planner-editorial__grid">
          {dates.map((date, dayIndex) => {
            const isToday = date === today;
            return (
              <div key={date} className="flex flex-col gap-4 min-w-0">
                <div className={`planner-editorial__day-head${isToday ? " is-today" : ""}`}>
                  <p className="dow font-headline">{COL_SHORT[dayIndex]}</p>
                  <p className="dom">{dayOfMonth(date)}</p>
                </div>
                <div className="planner-editorial__day-body">
                  {SLOTS.map((slot, slotIndex) => {
                    const recipeId = (planByDate[date] ?? ["", "", ""])[slotIndex];
                    const recipe = recipeId ? recipeById[recipeId] : null;
                    const isHighlight = draggingSlot?.date === date && draggingSlot?.slot === slot;
                    return (
                      <div key={slot} className="planner-slot-stack">
                        <span className={`planner-slot-stack__label font-headline ${slot}`}>{slot}</span>
                        {recipe ? (
                          <div className="relative" style={{ flex: 1, minHeight: "9rem" }}>
                            <button
                              type="button"
                              className="planner-meal-card w-full h-full"
                              onClick={() => removeMeal(date, slotIndex)}
                              title="Tap to remove"
                            >
                              {recipe.thumbnail_url ? (
                                <img src={recipe.thumbnail_url} alt="" className="planner-meal-card__img" />
                              ) : (
                                <div
                                  className="planner-meal-card__img"
                                  style={{
                                    background: "linear-gradient(145deg, var(--primary-fixed), var(--surface-container-high))",
                                  }}
                                />
                              )}
                              <div className="planner-meal-card__body">
                                <p className="planner-meal-card__title font-headline">{recipe.title}</p>
                              </div>
                            </button>
                            <button
                              type="button"
                              className="planner-meal-card__clear"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeMeal(date, slotIndex);
                              }}
                              aria-label="Remove meal"
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                            </button>
                          </div>
                        ) : (
                          <div
                            data-date={date}
                            data-slot-index={String(slotIndex)}
                            className={`planner-drop-target flex-1${isHighlight ? " is-drag-over" : ""}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                          >
                            <span className="material-symbols-outlined text-2xl opacity-40">add</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default function PlannerPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="planner-muted app-wide">Loading…</p>}>
        <PlannerPageContent />
      </Suspense>
    </RequireAuth>
  );
}
