"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, resolveRecipeDetails } from "@cooking/api-client";
import { useRecipePage } from "../lib/useRecipePage";
import { apiFetch, webApiClient } from "../lib/api";
import { userLocalStorage } from "../lib/userStorage";
import { RequireAuth } from "../components/RequireAuth";
import { PageHeader, PageShell } from "../components/PageShell";
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
import { useEditorialCopy } from "../lib/editorialCopy";
import { PlannerRecipeRail } from "./components/PlannerRecipeRail";
import { PlannerToolbar } from "./components/PlannerToolbar";
import { PlannerWeekBoard } from "./components/PlannerWeekBoard";
import { addRecipeToSlots, removeRecipeFromSlots } from "./plannerModel";
import { PLANNER_MEAL_LABEL_KEYS } from "./plannerMessages";
import styles from "./Planner.module.css";

const COL_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayMutation = (slots: MealPlanSlots) => MealPlanSlots;

type DateMutationQueue = {
  confirmed: MealPlanSlots;
  revision: number;
  conflicted: boolean;
  operations: DayMutation[];
  inFlight: boolean;
  generation: number;
};

type SlotPanel = {
  date: string;
  slot: MealType;
  mode: "add" | "manage";
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
  const editorialCopy = useEditorialCopy();
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
  const [slotPicker, setSlotPicker] = useState<SlotPanel | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [planLoadFailed, setPlanLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const mutationQueuesByDate = useRef<Record<string, DateMutationQueue>>({});
  const loadGeneration = useRef(0);
  const pickerDialogRef = useRef<HTMLDivElement>(null);
  const pickerTriggerRef = useRef<HTMLElement | null>(null);
  const pickerFallbackRef = useRef<HTMLElement | null>(null);
  const pickerWasOpenRef = useRef(false);

  const recipePage = useRecipePage("mine", {q: sideSearch, tags: categoryFilter === "all" ? [] : [categoryFilter]});
  const sidebarRecipes = recipePage.items;

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
        const [plansResult] = await Promise.allSettled([
          apiFetch(`/meal-plan?start=${start}&end=${end}`),
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
        const plans: MealPlanDay[] = await plansResult.value.json();
        const recs = await resolveRecipeDetails(webApiClient.recipes.get, plans.flatMap(plan => Object.values(normalizeMealPlanSlots(plan)).flat()));
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
                revision: plans.find(plan => plan.date === date)?.revision ?? 0,
                conflicted: false,
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
      userLocalStorage.setItem(
        plannerFingerprintStorageKey(start),
        buildWeekMealPlanFingerprint(dates, plansForFingerprint)
      );
    } catch {
      // ignore storage failures
    }
  }, [dates, loading, planByDate, planLoadFailed, start]);

  async function putDay(date: string, slots: MealPlanSlots, revision: number): Promise<MealPlanDay> {
    const res = await apiFetch(`/meal-plan/${date}`, {
      method: "PUT",
      body: JSON.stringify({ ...slots, expected_revision: revision }),
    });
    if (!res.ok) throw new ApiError("Failed to save meal plan", res.status, res.status === 409 ? "meal_plan_conflict" : null);
    const updated: MealPlanDay = await res.json();
    return updated;
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
      const saved = await putDay(date, target, queue.revision);
      if (!isCurrentQueue(date, queue)) return;
      queue.confirmed = normalizeMealPlanSlots(saved);
      queue.revision = saved.revision ?? queue.revision + 1;
      queue.operations.shift();
      queue.inFlight = false;
      paintQueue(date, queue);
    } catch (error) {
      if (!isCurrentQueue(date, queue)) return;
      if (error instanceof ApiError && error.status === 409) {
        queue.conflicted = true;
        queue.operations = [];
        setMutationError(t("planner.conflictReloading"));
        try {
          const response = await apiFetch(`/meal-plan?start=${date}&end=${date}`);
          if (!response.ok) throw new Error("Could not reload plan");
          const plans: MealPlanDay[] = await response.json();
          if (!isCurrentQueue(date, queue)) return;
          const latest = plans.find(plan => plan.date === date);
          queue.confirmed = normalizeMealPlanSlots(latest);
          queue.revision = latest?.revision ?? 0;
          queue.conflicted = false;
          queue.inFlight = false;
          paintQueue(date, queue);
          setMutationError(t("planner.conflict"));
          void resolveRecipeDetails(webApiClient.recipes.get, Object.values(queue.confirmed).flat()).then(recipes => {
            if (isCurrentQueue(date, queue)) setRecipes(current => [...new Map([...current, ...recipes].map(recipe => [recipe.id, recipe])).values()]);
          }).catch(() => undefined);
        } catch {
          if (isCurrentQueue(date, queue)) {
            queue.inFlight = false;
            setPlanLoadFailed(true);
            setMutationError(t("planner.conflictReloadFailed"));
          }
        }
        return;
      }
      queue.operations.shift();
      queue.inFlight = false;
      paintQueue(date, queue);
      setMutationError(t("planner.saveFailed"));
    }
    void runMutationQueue(date, queue);
  }

  function enqueueDayMutation(date: string, operation: DayMutation) {
    const queue = mutationQueuesByDate.current[date];
    if (!queue || queue.conflicted || !isCurrentQueue(date, queue)) return;
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
    const generation = loadGeneration.current;
    enqueueDayMutation(date, (slots) => addRecipeToSlots(slots, slot, recipeId));
    // Detail loading must not reorder the user's queued planner mutations.
    void webApiClient.recipes.get(recipeId).then(recipe => {
      if (loadGeneration.current === generation) setRecipes(current => [...current.filter(r => r.id !== recipeId), recipe]);
    }).catch(() => undefined);
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
    closeRecipePicker();
  }

  function closeRecipePicker() {
    setSlotPicker(null);
  }

  function openRecipePicker(date: string, slot: MealType) {
    openSlotPanel(date, slot, "add");
  }

  function openRecipeManager(date: string, slot: MealType) {
    openSlotPanel(date, slot, "manage");
  }

  function openSlotPanel(date: string, slot: MealType, mode: SlotPanel["mode"]) {
    if (planLoadFailed) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const slotIndex = String(MEAL_PLAN_SLOTS.indexOf(slot));
    const fallback = trigger?.closest<HTMLElement>("[data-testid='planner-meal-slot']")
      ?? Array.from(document.querySelectorAll<HTMLElement>("[data-testid='planner-meal-slot']")).find(
        (candidate) => candidate.dataset.date === date && candidate.dataset.slotIndex === slotIndex,
      )
      ?? null;
    pickerTriggerRef.current = trigger;
    pickerFallbackRef.current = fallback;
    setSlotPicker({ date, slot, mode });
  }

  useEffect(() => {
    if (!slotPicker) {
      if (!pickerWasOpenRef.current) return;
      pickerWasOpenRef.current = false;
      const trigger = pickerTriggerRef.current;
      const fallback = pickerFallbackRef.current;
      const target = trigger?.isConnected ? trigger : fallback?.isConnected ? fallback : null;
      target?.focus();
      pickerTriggerRef.current = null;
      pickerFallbackRef.current = null;
      return;
    }

    pickerWasOpenRef.current = true;
    const dialog = pickerDialogRef.current;
    const sheet = dialog?.querySelector<HTMLElement>(".planner-mobile-picker__sheet");
    const close = dialog?.querySelector<HTMLButtonElement>(".planner-mobile-picker__close");
    if (!dialog || !sheet || !close) return;

    const getFocusable = () => Array.from(
      sheet.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRecipePicker();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !sheet.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !sheet.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    close.focus();
    dialog.addEventListener("keydown", handleKeyDown);
    return () => dialog.removeEventListener("keydown", handleKeyDown);
  }, [slotPicker]);

  const slotPickerDayLabel = useMemo(() => {
    if (!slotPicker) return "";
    const index = dates.indexOf(slotPicker.date);
    const short = index >= 0 ? COL_SHORT[index] : slotPicker.date;
    return `${short} ${dayOfMonth(slotPicker.date)}`;
  }, [dates, slotPicker]);
  const slotPickerMealLabel = slotPicker ? t(PLANNER_MEAL_LABEL_KEYS[slotPicker.slot]) : "";
  const slotPickerRecipeIds = slotPicker
    ? (planByDate[slotPicker.date] ?? emptyMealPlanSlots())[slotPicker.slot]
    : [];
  const slotPickerRecipeIdSet = new Set(slotPickerRecipeIds);
  const slotPickerRecipes = slotPickerRecipeIds
    .map((recipeId) => recipeById[recipeId])
    .filter((recipe): recipe is Recipe => Boolean(recipe));

  if (loading) return <PageShell><p className={styles.status}>{t("common.loading")}</p></PageShell>;

  const recipeSourceControls = (
    <>
      <div className="planner-editorial__search">
        <span className="material-symbols-outlined" aria-hidden>search</span>
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
    </>
  );

  function renderRecipeSourceList(mode: "rail" | "picker") {
    return sidebarRecipes.length > 0 ? (
      sidebarRecipes.map((r) => (
        <div key={r.id} className={`planner-source-card planner-source-card--${mode}`}>
          <div
            draggable={mode === "rail" && !planLoadFailed}
            onDragStart={
              mode === "rail" && !planLoadFailed ? (e) => handleDragStart(e, r.id) : undefined
            }
            className="planner-drag-card"
          >
            <div className="planner-drag-card__thumb">
              {r.thumbnail_url ? <img src={r.thumbnail_url} alt={r.title} /> : null}
            </div>
            <div className="planner-drag-card__body">
              <h4 className="planner-drag-card__title font-headline">{r.title}</h4>
              {(() => {
                const tags = getRecipeTags(r);
                return (
                  <p className="planner-drag-card__meta">
                    {tags.length > 0
                      ? tags
                          .slice(0, 2)
                          .map((tag) => CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " "))
                          .join(" • ")
                      : t("recipe.ingredientsCount", { count: r.ingredient_count })}
                  </p>
                );
              })()}
            </div>
          </div>
          {mode === "picker" ? (
            <button
              type="button"
              className="planner-source-card__add font-headline"
              onClick={() => handlePickerSelect(r.id)}
              disabled={slotPickerRecipeIdSet.has(r.id)}
              aria-label={`${t(slotPickerRecipeIdSet.has(r.id) ? "common.added" : "common.add")} ${r.title}`}
            >
              {t(slotPickerRecipeIdSet.has(r.id) ? "common.added" : "common.add")}
            </button>
          ) : null}
        </div>
      ))
    ) : (
      <p className="planner-source-empty">
        {!sideSearch.trim() && categoryFilter === "all" ? (
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
  }

  const pagination = <>{recipePage.error ? <p role="alert">{recipePage.error}</p> : null}{recipePage.next ? <button type="button" disabled={recipePage.loading} onClick={() => void recipePage.more()}>{t("common.loadMoreRecipes")}</button> : null}</>;
  const railRecipeSourceList = <>{renderRecipeSourceList("rail")}{pagination}</>;
  const pickerRecipeSourceList = <>{renderRecipeSourceList("picker")}{pagination}</>;

  return (
    <PageShell className={styles.page}>
      <PageHeader title={t("planner.title")} description={editorialCopy["planner.tagline"]} />

      <div className={styles.workspace}>
        <PlannerRecipeRail
          controls={
            <>
              <h2 className="cw-display">{t("planner.savedRecipes")}</h2>
              <p className="planner-editorial__sidebar-description">{t("planner.savedRecipesDesc")}</p>
              {recipeSourceControls}
            </>
          }
          recipes={railRecipeSourceList}
        />

        <div className={styles.boardArea}>
          <PlannerToolbar
            weekRange={formatWeekPlannerKicker(start, end)}
            onPrevious={() => setWeek(prev)}
            onNext={() => setWeek(next)}
          />
          <div className={styles.board}>

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
            openRecipePicker(date, slot);
          }}
          onManage={openRecipeManager}
          onOpen={openRecipe}
          onRemove={removeMeal}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />

        {slotPicker ? (
          <div
            ref={pickerDialogRef}
            className="planner-mobile-picker"
            role="dialog"
            aria-modal="true"
            aria-label={t(
              slotPicker.mode === "manage"
                ? "planner.manageRecipeSlot"
                : "planner.chooseRecipeForMealSlot",
            )}
          >
            <button
              type="button"
              className="planner-mobile-picker__backdrop"
              aria-label={t("planner.closeRecipePicker")}
              onClick={closeRecipePicker}
            />
            <div className="planner-mobile-picker__sheet">
              <div className="planner-mobile-picker__head">
                <div>
                  <p className="planner-mobile-picker__kicker font-headline">{slotPickerDayLabel}</p>
                  <h2 className="planner-mobile-picker__title font-headline">
                    {t(
                      slotPicker.mode === "manage"
                        ? "planner.plannedForSlot"
                        : "planner.addToSlot",
                      { slot: slotPickerMealLabel },
                    )}
                  </h2>
                </div>
                <button
                  type="button"
                  className="planner-mobile-picker__close"
                  onClick={closeRecipePicker}
                  aria-label={t("planner.closeRecipePicker")}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                  <span className="planner-mobile-picker__close-label">
                    {t("planner.closeRecipePicker")}
                  </span>
                </button>
              </div>
              {slotPicker.mode === "add" ? (
                <>
                  <div className="planner-mobile-picker__controls">{recipeSourceControls}</div>
                  <div className="planner-mobile-picker__list">{pickerRecipeSourceList}</div>
                </>
              ) : (
                <>
                  <div className="planner-slot-manager__list">
                    {slotPickerRecipes.length ? slotPickerRecipes.map((recipe) => (
                      <div key={recipe.id} className="planner-slot-manager__recipe">
                        <div className="planner-slot-manager__thumb">
                          {recipe.thumbnail_url ? <img src={recipe.thumbnail_url} alt="" /> : null}
                        </div>
                        <p className="planner-slot-manager__title font-headline" title={recipe.title}>
                          {recipe.title}
                        </p>
                        <button
                          type="button"
                          className="planner-slot-manager__remove font-headline"
                          onClick={() => removeMeal(slotPicker.date, slotPicker.slot, recipe.id)}
                          disabled={planLoadFailed}
                          aria-label={t("planner.removeRecipeFromSlot", {
                            title: recipe.title,
                            slot: slotPickerMealLabel,
                            date: slotPicker.date,
                          })}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">close</span>
                        </button>
                      </div>
                    )) : (
                      <p className="planner-source-empty">{t("planner.noRecipesPlanned")}</p>
                    )}
                  </div>
                  <div className="planner-slot-manager__footer">
                    <button
                      type="button"
                      className="planner-slot-manager__add font-headline"
                      onClick={() => setSlotPicker((current) => current ? { ...current, mode: "add" } : null)}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">add</span>
                      {t("planner.addRecipe")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
          </div>
        </div>
      </div>
    </PageShell>
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
