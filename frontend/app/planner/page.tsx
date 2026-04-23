"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useT } from "../lib/i18n";
import { TagFilterPopover } from "../components/TagFilterPopover";
import type { Recipe } from "../types";
import { getWeekBounds, getPrevNextWeek, formatWeekPlannerKicker } from "../lib/week";
import { CATEGORY_LABELS, type LibraryFilterId } from "../lib/recipeCategories";
import {
  MEAL_PLAN_SLOTS,
  type MealPlanDay,
  type MealPlanSlots,
  type MealType,
  buildWeekMealPlanFingerprint,
  emptyMealPlanSlots,
  normalizeMealPlanSlots,
  plannerFingerprintStorageKey,
} from "../lib/mealPlan";

const COL_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const t = useT();
  const searchParams = useSearchParams();
  const weekParam = searchParams.get("week");
  const { start, end, dates, weekParam: currentWeek } = getWeekBounds(weekParam);
  const { prev, next } = getPrevNextWeek(currentWeek);
  const today = todayYmd();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [planByDate, setPlanByDate] = useState<Record<string, MealPlanSlots>>({});
  const [loading, setLoading] = useState(true);
  const [draggingSlot, setDraggingSlot] = useState<{ date: string; slot: MealType } | null>(null);
  const [sideSearch, setSideSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<LibraryFilterId>("all");
  const [slotPicker, setSlotPicker] = useState<{ date: string; slot: MealType } | null>(null);

  const sidebarRecipes = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    return [...recipes]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .filter((r) => {
        const tags = r.library_tags ?? (r.library_category ? [r.library_category] : []);
        if (categoryFilter !== "all" && !tags.includes(categoryFilter)) return false;
        if (q && !r.title.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [recipes, sideSearch, categoryFilter]);

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
          const plans: MealPlanDay[] = await plansRes.json();
          const nextPlan: Record<string, MealPlanSlots> = {};
          plans.forEach((p) => {
            nextPlan[p.date] = normalizeMealPlanSlots(p);
          });
          dates.forEach((d) => {
            if (!nextPlan[d]) nextPlan[d] = emptyMealPlanSlots();
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

  useEffect(() => {
    if (loading) return;
    const plansForFingerprint: MealPlanDay[] = dates.map((date) => ({
      date,
      ...(planByDate[date] ?? emptyMealPlanSlots()),
    }));
    try {
      localStorage.setItem(
        plannerFingerprintStorageKey(start),
        buildWeekMealPlanFingerprint(dates, plansForFingerprint)
      );
    } catch {
      // ignore storage failures
    }
  }, [dates, loading, planByDate, start]);

  async function putDay(date: string, slots: MealPlanSlots) {
    const res = await apiFetch(`/meal-plan/${date}`, {
      method: "PUT",
      body: JSON.stringify(slots),
    });
    if (!res.ok) return false;
    const updated: MealPlanDay = await res.json();
    setPlanByDate((prev) => ({
      ...prev,
      [date]: normalizeMealPlanSlots(updated),
    }));
    return true;
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
      setDraggingSlot({ date, slot: MEAL_PLAN_SLOTS[Number(slotIndex)] });
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
    const slot = MEAL_PLAN_SLOTS[slotIndex];
    const recipeId = e.dataTransfer.getData("recipeId");
    if (!recipeId) return;
    await addRecipeToSlot(date, slot, recipeId);
  }

  async function addRecipeToSlot(date: string, slot: MealType, recipeId: string) {
    const current = planByDate[date] ?? emptyMealPlanSlots();
    const nextSlots: MealPlanSlots = {
      breakfast: [...current.breakfast],
      lunch: [...current.lunch],
      dinner: [...current.dinner],
    };
    if (nextSlots[slot].includes(recipeId)) return;
    nextSlots[slot] = [...nextSlots[slot], recipeId];
    setPlanByDate((prev) => ({ ...prev, [date]: nextSlots }));
    await putDay(date, nextSlots);
  }

  async function removeMeal(date: string, slot: MealType, recipeId: string) {
    const current = planByDate[date] ?? emptyMealPlanSlots();
    const nextSlots: MealPlanSlots = {
      breakfast: [...current.breakfast],
      lunch: [...current.lunch],
      dinner: [...current.dinner],
    };
    nextSlots[slot] = nextSlots[slot].filter((id) => id !== recipeId);
    setPlanByDate((prev) => ({ ...prev, [date]: nextSlots }));
    await putDay(date, nextSlots);
  }

  const recipeById: Record<string, Recipe> = {};
  recipes.forEach((r) => (recipeById[r.id] = r));

  function setWeek(week: string) {
    router.push(`/planner?week=${week}`);
  }

  function openRecipe(recipeId: string) {
    router.push(`/recipe/${recipeId}`);
  }

  async function handlePickerSelect(recipeId: string) {
    if (!slotPicker) return;
    await addRecipeToSlot(slotPicker.date, slotPicker.slot, recipeId);
    setSlotPicker(null);
  }

  const slotPickerDayLabel = useMemo(() => {
    if (!slotPicker) return "";
    const index = dates.indexOf(slotPicker.date);
    const short = index >= 0 ? COL_SHORT[index] : slotPicker.date;
    return `${short} ${dayOfMonth(slotPicker.date)}`;
  }, [dates, slotPicker]);

  if (loading) return <p className="planner-muted app-wide">{t("common.loading")}</p>;

  const recipeSourceControls = (
    <>
      <div className="planner-editorial__search">
        <span className="material-symbols-outlined">search</span>
        <input
          type="search"
          placeholder={t("planner.searchLibrary")}
          value={sideSearch}
          onChange={(e) => setSideSearch(e.target.value)}
          aria-label={t("planner.searchAria")}
        />
      </div>
      <div className="planner-filter-bar">
        <TagFilterPopover
          value={categoryFilter}
          onChange={setCategoryFilter}
          ariaLabel={t("planner.filterAria")}
        />
        {categoryFilter !== "all" ? (
          <button
            type="button"
            className="planner-filter-reset font-headline"
            onClick={() => setCategoryFilter("all")}
          >
            {t("planner.clearFilter")}
          </button>
        ) : null}
      </div>
      <p className="planner-sort-note">{t("planner.sortedAZ")}</p>
    </>
  );

  const recipeSourceList = sidebarRecipes.length > 0 ? (
    sidebarRecipes.map((r) => (
      <div key={r.id} className="planner-source-card">
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, r.id)}
          className="planner-drag-card"
        >
          <div className="planner-drag-card__thumb">
            {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" /> : null}
          </div>
          <div className="planner-drag-card__body">
            <h4 className="planner-drag-card__title font-headline">{r.title}</h4>
            {(r.library_tags?.length || r.library_category) ? (
              <p className="planner-drag-card__meta">
                {(r.library_tags ?? (r.library_category ? [r.library_category] : []))
                  .slice(0, 2)
                  .map((tag) => CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " "))
                  .join(" • ")}
              </p>
            ) : null}
          </div>
        </div>
        {slotPicker ? (
          <button type="button" className="planner-source-card__add font-headline" onClick={() => handlePickerSelect(r.id)}>
            {t("common.add")}
          </button>
        ) : null}
      </div>
    ))
  ) : (
    <p className="planner-source-empty">
      {recipes.length === 0 ? (
        <>
          <Link href="/import" className="font-bold">
                {t("planner.importRecipes")}
          </Link>{" "}
              {t("planner.planYourWeek")}
        </>
      ) : (
            t("planner.noRecipesMatch")
      )}
    </p>
  );

  return (
    <div className="planner-editorial app-wide" style={{ maxWidth: "100%" }}>
      <aside className="planner-editorial__sidebar">
        <div className="planner-editorial__sidebar-head space-y-4">
          <div>
            <h2 className="font-headline m-0 mb-2" style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--on-surface)", letterSpacing: "-0.02em" }}>
              {t("planner.savedRecipes")}
            </h2>
            <p className="m-0 text-sm" style={{ color: "var(--on-surface-variant)" }}>
              {t("planner.savedRecipesDesc")}
            </p>
          </div>
          {recipeSourceControls}
        </div>
        <div className="planner-editorial__sidebar-scroll">{recipeSourceList}</div>
        <div className="planner-editorial__sidebar-foot">
          <Link href="/import" className="btn-primary font-headline w-full flex items-center justify-center gap-2" style={{ width: "100%", textDecoration: "none" }}>
            <span className="material-symbols-outlined">add</span>
            {t("planner.newRecipe")}
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
              {t("planner.title")}
            </h1>
            <p className="m-0 mt-2 text-sm max-w-xl" style={{ color: "var(--on-surface-variant)", lineHeight: 1.5 }}>
              Drag recipes from the sidebar into breakfast, lunch, and dinner.{" "}
              <Link href={`/shopping-list?week=${currentWeek}`} className="font-bold" style={{ color: "var(--primary)" }}>
                {t("nav.shoppingList")}
              </Link>{" "}
              {t("planner.shoppingListUsesPlan")}
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
              aria-label={t("common.previous")}
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
              aria-label={t("common.next")}
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </section>

        <div className="planner-mobile-guide">
          <p className="planner-mobile-guide__title font-headline">{t("planner.phoneFriendlyTitle")}</p>
          <p className="planner-mobile-guide__text">{t("planner.phoneFriendlyDesc")}</p>
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
                  {MEAL_PLAN_SLOTS.map((slot, slotIndex) => {
                    const recipeIds = (planByDate[date] ?? emptyMealPlanSlots())[slot];
                    const isHighlight = draggingSlot?.date === date && draggingSlot?.slot === slot;
                    return (
                      <div key={slot} className="planner-slot-stack">
                        <span className={`planner-slot-stack__label font-headline ${slot}`}>{slot}</span>
                        <div
                          data-date={date}
                          data-slot-index={String(slotIndex)}
                          className={`planner-drop-target flex-1${isHighlight ? " is-drag-over" : ""}${recipeIds.length ? " planner-drop-target--filled" : ""}`}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                        >
                          {recipeIds.length ? (
                            <div className="planner-slot-recipes">
                              {recipeIds.map((recipeId) => {
                                const recipe = recipeById[recipeId];
                                if (!recipe) return null;
                                return (
                                  <div key={recipeId} className="planner-slot-recipe">
                                    <button
                                      type="button"
                                      className="planner-meal-card w-full h-full"
                                      onClick={() => openRecipe(recipeId)}
                                      aria-label={`Open ${recipe.title}`}
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
                                        removeMeal(date, slot, recipeId);
                                      }}
                                      aria-label={t("planner.removeMeal")}
                                    >
                                      <span className="material-symbols-outlined text-sm">close</span>
                                    </button>
                                  </div>
                                );
                              })}
                              <span className="planner-drop-target__hint">{t("planner.dropAnotherRecipe")}</span>
                              <button
                                type="button"
                                className="planner-slot-action planner-slot-action--mobile font-headline"
                                onClick={() => setSlotPicker({ date, slot })}
                              >
                                {t("planner.addAnotherRecipe")}
                              </button>
                              <button
                                type="button"
                                className="planner-slot-action planner-slot-action--desktop-icon"
                                onClick={() => setSlotPicker({ date, slot })}
                                aria-label={`Choose another recipe for ${slot} on ${date}`}
                              >
                                <span className="material-symbols-outlined">add</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="planner-slot-empty-trigger"
                              onClick={() => setSlotPicker({ date, slot })}
                              aria-label={`Choose a recipe for ${slot} on ${date}`}
                            >
                              <span className="planner-slot-plus" aria-hidden="true">
                                <span className="material-symbols-outlined text-2xl opacity-40">add</span>
                              </span>
                              <span className="planner-slot-empty-trigger__label planner-slot-action--mobile font-headline">
                                {t("planner.chooseRecipe")}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {slotPicker ? (
          <div className="planner-mobile-picker" role="dialog" aria-modal="true" aria-label={t("planner.chooseRecipeForMealSlot")}>
            <button
              type="button"
              className="planner-mobile-picker__backdrop"
              aria-label={t("planner.closeRecipePicker")}
              onClick={() => setSlotPicker(null)}
            />
            <div className="planner-mobile-picker__sheet">
              <div className="planner-mobile-picker__head">
                <div>
                  <p className="planner-mobile-picker__kicker font-headline">{slotPickerDayLabel}</p>
                  <h2 className="planner-mobile-picker__title font-headline">
                    {t("planner.addToSlot", { slot: slotPicker.slot })}
                  </h2>
                </div>
                <button
                  type="button"
                  className="planner-mobile-picker__close"
                  onClick={() => setSlotPicker(null)}
                  aria-label={t("planner.closeRecipePicker")}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="planner-mobile-picker__controls">{recipeSourceControls}</div>
              <div className="planner-mobile-picker__list">{recipeSourceList}</div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default function PlannerPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="planner-muted app-wide">Loading...</p>}>
        <PlannerPageContent />
      </Suspense>
    </RequireAuth>
  );
}
