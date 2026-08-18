"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useT } from "../lib/i18n";
import { TagFilterPopover } from "../components/TagFilterPopover";
import type { Recipe } from "../types";
import {
  MEAL_PLAN_SLOTS,
  buildWeekMealPlanFingerprint,
  emptyMealPlanSlots,
  formatWeekPlannerKicker,
  getPrevNextWeek,
  getWeekBounds,
  normalizeMealPlanSlots,
  plannerFingerprintStorageKey,
  type MealPlanDay,
  type MealPlanSlots,
  type MealType,
} from "@cooking/shared";
import { CATEGORY_LABELS, type LibraryFilterId } from "../lib/recipeCategories";
import { getRecipeTags } from "../lib/recipeTags";
import { PlannerRecipeRail } from "./components/PlannerRecipeRail";
import { PlannerToolbar } from "./components/PlannerToolbar";
import { PlannerWeekBoard } from "./components/PlannerWeekBoard";
import { addRecipeToSlots, removeRecipeFromSlots } from "./plannerModel";
import { PLANNER_MEAL_LABEL_KEYS } from "./plannerMessages";

const COL_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayMutation = (slots: MealPlanSlots) => MealPlanSlots;

type DateMutationQueue = {
  confirmed: MealPlanSlots;
  operations: DayMutation[];
  inFlight: boolean;
  generation: number;
};

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
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [planLoadFailed, setPlanLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const mutationQueuesByDate = useRef<Record<string, DateMutationQueue>>({});
  const loadGeneration = useRef(0);

  const sidebarRecipes = useMemo(() => {
    const q = sideSearch.trim().toLowerCase();
    return [...recipes]
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      .filter((r) => {
        const tags = getRecipeTags(r);
        if (categoryFilter !== "all" && !tags.includes(categoryFilter)) return false;
        if (q && !r.title.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [recipes, sideSearch, categoryFilter]);

  useEffect(() => {
    let cancelled = false;
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    mutationQueuesByDate.current = {};
    async function load() {
      setLoading(true);
      setPlanByDate({});
      setSlotPicker(null);
      setDraggingSlot(null);
      setMutationError(null);
      setPlanLoadFailed(false);
      try {
        const [plansResult, recipesResult] = await Promise.allSettled([
          apiFetch(`/meal-plan?start=${start}&end=${end}`),
          apiFetch("/recipes"),
        ]);
        const nextPlan: Record<string, MealPlanSlots> = Object.fromEntries(
          dates.map((date) => [date, emptyMealPlanSlots()]),
        );
        if (plansResult.status === "rejected" || !plansResult.value.ok) {
          if (!cancelled && loadGeneration.current === generation) {
            mutationQueuesByDate.current = {};
            setPlanByDate(nextPlan);
            setPlanLoadFailed(true);
          }
          return;
        }
        if (recipesResult.status === "rejected" || !recipesResult.value.ok) {
          throw new Error("Failed to load recipes");
        }
        const [plans, recs]: [MealPlanDay[], Recipe[]] = await Promise.all([
          plansResult.value.json(),
          recipesResult.value.json(),
        ]);
        if (!cancelled) setRecipes(recs);
        plans.forEach((p) => {
          nextPlan[p.date] = normalizeMealPlanSlots(p);
        });
        if (!cancelled && loadGeneration.current === generation) {
          mutationQueuesByDate.current = Object.fromEntries(
            dates.map((date) => [
              date,
              {
                confirmed: nextPlan[date],
                operations: [],
                inFlight: false,
                generation,
              },
            ]),
          );
          setPlanByDate(nextPlan);
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
  }, [start, end, dates.join(","), loadAttempt]);

  useEffect(() => {
    if (loading || planLoadFailed) return;
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
  }, [dates, loading, planByDate, planLoadFailed, start]);

  async function putDay(date: string, slots: MealPlanSlots): Promise<MealPlanSlots> {
    const res = await apiFetch(`/meal-plan/${date}`, {
      method: "PUT",
      body: JSON.stringify(slots),
    });
    if (!res.ok) throw new Error("Failed to save meal plan");
    const updated: MealPlanDay = await res.json();
    return normalizeMealPlanSlots(updated);
  }

  function isCurrentQueue(date: string, queue: DateMutationQueue) {
    return (
      loadGeneration.current === queue.generation &&
      mutationQueuesByDate.current[date] === queue
    );
  }

  function optimisticSlots(queue: DateMutationQueue) {
    return queue.operations.reduce(
      (slots, operation) => operation(slots),
      queue.confirmed,
    );
  }

  function paintQueue(date: string, queue: DateMutationQueue) {
    if (!isCurrentQueue(date, queue)) return;
    const slots = optimisticSlots(queue);
    setPlanByDate((current) => ({ ...current, [date]: slots }));
  }

  async function runMutationQueue(date: string, queue: DateMutationQueue) {
    if (queue.inFlight || queue.operations.length === 0 || !isCurrentQueue(date, queue)) return;
    queue.inFlight = true;
    const operation = queue.operations[0];
    const target = operation(queue.confirmed);
    try {
      const saved = await putDay(date, target);
      if (!isCurrentQueue(date, queue)) return;
      queue.confirmed = saved;
      queue.operations.shift();
      queue.inFlight = false;
      paintQueue(date, queue);
    } catch {
      if (!isCurrentQueue(date, queue)) return;
      queue.operations.shift();
      queue.inFlight = false;
      paintQueue(date, queue);
      setMutationError(t("planner.saveFailed"));
    }
    void runMutationQueue(date, queue);
  }

  function enqueueDayMutation(date: string, operation: DayMutation) {
    const queue = mutationQueuesByDate.current[date];
    if (!queue || !isCurrentQueue(date, queue)) return;
    queue.operations.push(operation);
    setMutationError(null);
    paintQueue(date, queue);
    void runMutationQueue(date, queue);
  }

  function handleDragStart(e: React.DragEvent, recipeId: string) {
    if (planLoadFailed) return;
    e.dataTransfer.setData("recipeId", recipeId);
    e.dataTransfer.effectAllowed = "copy";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (planLoadFailed) return;
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
    if (planLoadFailed) return;
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
    if (planLoadFailed) return;
    const current = planByDate[date] ?? emptyMealPlanSlots();
    if (current[slot].includes(recipeId)) return;
    enqueueDayMutation(date, (slots) => addRecipeToSlots(slots, slot, recipeId));
  }

  async function removeMeal(date: string, slot: MealType, recipeId: string) {
    if (planLoadFailed) return;
    enqueueDayMutation(date, (slots) => removeRecipeFromSlots(slots, slot, recipeId));
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
  const slotPickerMealLabel = slotPicker ? t(PLANNER_MEAL_LABEL_KEYS[slotPicker.slot]) : "";

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
          draggable={!planLoadFailed}
          onDragStart={planLoadFailed ? undefined : (e) => handleDragStart(e, r.id)}
          className="planner-drag-card"
        >
          <div className="planner-drag-card__thumb">
            {r.thumbnail_url ? <img src={r.thumbnail_url} alt="" /> : null}
          </div>
          <div className="planner-drag-card__body">
            <h4 className="planner-drag-card__title font-headline">{r.title}</h4>
            {(() => {
              const tags = getRecipeTags(r);
              if (tags.length === 0) return null;
              return (
                <p className="planner-drag-card__meta">
                  {tags
                    .slice(0, 2)
                    .map((tag) => CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " "))
                    .join(" • ")}
                </p>
              );
            })()}
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
    <div className="planner-editorial app-wide">
      <div className="planner-editorial__toolbar-shell">
        <PlannerToolbar
          weekRange={formatWeekPlannerKicker(start, end)}
          shoppingHref={`/shopping-list?week=${currentWeek}`}
          onPrevious={() => setWeek(prev)}
          onNext={() => setWeek(next)}
        />
      </div>

      <PlannerRecipeRail
        controls={
          <>
            <div>
              <h2 className="font-headline m-0 mb-2" style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--on-surface)", letterSpacing: "-0.02em" }}>
                {t("planner.savedRecipes")}
              </h2>
              <p className="m-0 text-sm" style={{ color: "var(--on-surface-variant)" }}>
                {t("planner.savedRecipesDesc")}
              </p>
            </div>
            {recipeSourceControls}
          </>
        }
        recipes={recipeSourceList}
      />

      <main className="planner-editorial__main">
        <div className="planner-mobile-guide">
          <p className="planner-mobile-guide__title font-headline">{t("planner.phoneFriendlyTitle")}</p>
          <p className="planner-mobile-guide__text">{t("planner.phoneFriendlyDesc")}</p>
        </div>

        {mutationError ? (
          <div role="status" className="planner-mutation-error">
            <span>{mutationError}</span>
            <button type="button" onClick={() => setMutationError(null)}>
              {t("planner.dismissError")}
            </button>
          </div>
        ) : null}

        {planLoadFailed ? (
          <div role="status" className="planner-mutation-error">
            <span>{t("planner.loadFailed")}</span>
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              {t("planner.retryLoad")}
            </button>
          </div>
        ) : null}

        <PlannerWeekBoard
          dates={dates}
          today={today}
          planByDate={planByDate}
          recipesById={recipeById}
          draggingSlot={draggingSlot}
          mutationsDisabled={planLoadFailed}
          onChoose={(date, slot) => {
            if (!planLoadFailed) setSlotPicker({ date, slot });
          }}
          onOpen={openRecipe}
          onRemove={removeMeal}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />

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
                    {t("planner.addToSlot", { slot: slotPickerMealLabel })}
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
