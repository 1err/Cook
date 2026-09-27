"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useAuth } from "../lib/auth";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useT } from "../lib/i18n";
import { useEditorialCopy } from "../lib/editorialCopy";
import { RecipeCard } from "../components/RecipeCard";
import { Icon } from "../components/ui/Icon";
import { PageHeader, PageShell } from "../components/PageShell";
import { CATEGORY_LABELS, type LibraryFilterId, type RecipeTagSlug } from "../lib/recipeCategories";
import { getRecipeTags } from "../lib/recipeTags";
import { TagFilterPopover } from "../components/TagFilterPopover";
import { useRecipePage } from "../lib/useRecipePage";
import { LibraryMasonry } from "./LibraryMasonry";
import styles from "./LibraryPage.module.css";

const MenuMaker = dynamic(() => import("./menu/MenuLibraryLoader").then(module => module.MenuLibraryLoader), { ssr: false });

function LibraryPageContent() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const searchParams = useSearchParams();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const highlightId = searchParams.get("highlight");
  const [error, setError] = useState<string | null>(null);
  const [mineFilters, setMineFilters] = useState<RecipeTagSlug[]>([]);
  const [publicFilter, setPublicFilter] = useState<LibraryFilterId>("all");
  const [search, setSearch] = useState("");
  const [catalogVisited, setCatalogVisited] = useState(searchParams.get("view") === "public");
  const [view, setView] = useState<"mine" | "public">(searchParams.get("view") === "public" ? "public" : "mine");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const t = useT();
  const copy = useEditorialCopy();

  const minePage = useRecipePage("mine", { q: search, tags: mineFilters });
  const catalogPage = useRecipePage("catalog", { q: search, tags: publicFilter === "all" ? [] : [publicFilter] }, catalogVisited);
  const page = view === "mine" ? minePage : catalogPage;
  const recipes = view === "mine" ? page.items : [];
  const publicRecipes = view === "public" ? page.items : [];
  const loading = page.loading && !page.items.length;
  const filteredMine = recipes;
  const filteredPublic = publicRecipes;
  const [savedPublicIds, setSavedPublicIds] = useState(new Set<string>());

  const mineFilterLabel = useMemo(() => {
    if (mineFilters.length === 0) return "All tags";
    if (mineFilters.length === 1) return CATEGORY_LABELS[mineFilters[0]];
    return `${mineFilters.length} tags`;
  }, [mineFilters]);

  function toggleMineFilter(tag: RecipeTagSlug) {
    setMineFilters((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  async function handleCopyPublicRecipe(recipeId: string) {
    setCopyingId(recipeId);
    setError(null);
    try {
      const response = await apiFetch(`/recipes/catalog/${recipeId}/copy`, { method: "POST" });
      if (!response.ok) throw new Error((await response.text()) || "Could not add recipe");
      if (!mounted.current) return;
      setSavedPublicIds(current => new Set(current).add(recipeId));
      void minePage.refresh();
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "Could not add recipe");
    } finally {
      if (mounted.current) setCopyingId(null);
    }
  }

  const hasFilters = Boolean(search.trim()) || (view === "mine" ? mineFilters.length > 0 : publicFilter !== "all");
  const activeList = view === "mine" ? filteredMine : filteredPublic;

  if (menuOpen) return <MenuMaker initialSearch={search} initialFilters={mineFilters} onClose={() => { setMenuOpen(false); requestAnimationFrame(() => menuTrigger.current?.focus()); }} />;

  return (
    <>
      <div className={styles.headingRow}>
        <PageHeader title={t("library.title")} description={copy["library.tagline"]} />
        {view === "mine" ? <button ref={menuTrigger} type="button" className={styles.menuButton} onClick={() => setMenuOpen(true)}><Icon name="menuCard" size={18} />{t("menu.make")}</button> : null}
      </div>

      <div className={styles.tabs} role="tablist" aria-label={t("library.views")}>
        <button
          type="button"
          role="tab"
          aria-selected={view === "mine"}
          className={styles.tab}
          onClick={() => setView("mine")}
        >
          {t("library.myLibrary")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "public"}
          className={styles.tab}
          onClick={() => { setCatalogVisited(true); setView("public"); }}
        >
          {t("library.publicLibrary")}
        </button>
        <Link href="/library/friends" role="tab" aria-selected={false} className={styles.tab}>
          {copy["library.friends"]}
        </Link>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" strokeLinecap="round" />
          </svg>
          <span className={styles.visuallyHidden}>{t("library.searchAria")}</span>
          <input
            type="search"
            placeholder={t("library.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        {view === "mine" ? (
          <TagFilterPopover
            values={mineFilters}
            onToggleValue={toggleMineFilter}
            onClear={() => setMineFilters([])}
            ariaLabel={t("library.filterAria")}
            triggerLabel={mineFilterLabel}
          />
        ) : (
          <TagFilterPopover
            value={publicFilter}
            onChange={setPublicFilter}
            ariaLabel={t("library.filterAria")}
          />
        )}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {page.error ? <div>
        <p className={styles.error} role="alert">{page.error}</p>
        <button type="button" disabled={page.loading} onClick={() => void page.refresh()}>{t("library.retry")}</button>
      </div> : null}

      {loading ? (
        <p className={styles.status}>{t("common.loading")}</p>
      ) : activeList.length === 0 && page.error ? null : activeList.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {view === "mine"
              ? recipes.length === 0 && !hasFilters
                ? t("library.yourShelfReady")
                : t("common.noMatches")
              : publicRecipes.length === 0 && !hasFilters
                ? t("library.publicShelfEmpty")
                : t("common.noMatches")}
          </p>
          <span className={styles.emptyDescription}>
            {view === "mine" && recipes.length === 0 && !hasFilters
              ? t("library.importRecipePrompt")
              : hasFilters
                ? t("library.tryAnotherFilter")
                : t("library.publicShelfEmptyDesc")}
          </span>
          {view === "mine" && recipes.length === 0 && !hasFilters ? (
            <Link href="/import">{t("library.addRecipe")} →</Link>
          ) : null}
        </div>
      ) : (
        <LibraryMasonry>
          {activeList.map((recipe) => {
            if (view === "mine") {
              return (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  isHighlighted={highlightId === recipe.id}
                />
              );
            }

            const alreadyAdded = recipe.already_saved || savedPublicIds.has(recipe.id);
            const tags = getRecipeTags(recipe).slice(0, 2);
            return (
              <article key={recipe.id} role="listitem" className={styles.publicCard}>
                <Link href={`/library/public/${encodeURIComponent(recipe.id)}`} className={styles.publicLink}>
                  <div className={`${styles.publicMedia} ${recipe.thumbnail_url ? "" : styles.publicMediaPlaceholder}`}>
                    {recipe.thumbnail_url ? (
                      <img src={recipe.thumbnail_url} alt="" />
                    ) : (
                      <span className="cw-display" aria-hidden>CW</span>
                    )}
                  </div>
                  <div className={styles.publicBody}>
                    <h2 className="cw-display">{recipe.title}</h2>
                    <div className={styles.metadata}>
                      {recipe.total_time_minutes ? <p>{recipe.total_time_minutes} {t("recipe.totalTime.minutesSuffix")}</p> : null}
                      {tags.length ? (
                        <div className={styles.publicTags}>
                          {tags.map((tag) => (
                            <span key={tag}>{CATEGORY_LABELS[tag] ?? tag.replace(/_/g, " ")}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() => handleCopyPublicRecipe(recipe.id)}
                  disabled={alreadyAdded || copyingId === recipe.id}
                >
                  {alreadyAdded
                    ? t("library.inYourLibrary")
                    : copyingId === recipe.id
                      ? t("library.adding")
                      : t("library.addToMyLibrary")}
                </button>
              </article>
            );
          })}
        </LibraryMasonry>
      )}
      {page.next ? <button type="button" disabled={page.loading} onClick={() => void page.more()}>{t("common.loadMoreRecipes")}</button> : null}
    </>
  );
}

export default function LibraryPage() {
  const { user } = useAuth();
  return (
    <RequireAuth>
      <PageShell>
        <Suspense fallback={<p className={styles.status}>Loading...</p>}>
          <LibraryPageContent key={user?.id ?? "signed-out"} />
        </Suspense>
      </PageShell>
    </RequireAuth>
  );
}
