"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { IngredientOption } from "@cooking/shared";
import { useAuth } from "../lib/auth";
import { apiFetch, webApiClient } from "../lib/api";
import { RequireAuth } from "../components/RequireAuth";
import { useI18n, useT } from "../lib/i18n";
import { useEditorialCopy } from "../lib/editorialCopy";
import { RecipeTiming } from "../components/RecipeTiming";
import { Button, ActionLink } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { PageHeader, PageShell } from "../components/PageShell";
import type { RecipeTagSlug } from "../lib/recipeCategories";
import { TagFilterPopover } from "../components/TagFilterPopover";
import { useLibrarySearch } from "../lib/useLibrarySearch";
import { PublicRecipeSaveButton } from "./PublicRecipeSaveButton";
import { IngredientSearch, ingredientLabel } from "./IngredientSearch";
import { RemainingIngredients } from "./RemainingIngredients";
import styles from "./LibraryPage.module.css";
const MenuMaker=dynamic(()=>import("./menu/MenuLibraryLoader").then(module=>module.MenuLibraryLoader),{ssr:false});
type Collection="all"|"mine"|"catalog";

function LibraryPageContent() {
  const searchParams=useSearchParams();const initial:Collection=searchParams.get("view")==="public"?"catalog":searchParams.get("view")==="mine" || searchParams.has("highlight")?"mine":"all";
  const [view,setView]=useState<Collection>(initial);const [visited,setVisited]=useState(new Set<Collection>([initial]));
  const [mode,setMode]=useState<"name"|"ingredients">("name");const [search,setSearch]=useState("");const [debouncedSearch,setDebouncedSearch]=useState("");
  const [ingredients,setIngredients]=useState<string[]>([]);const [match,setMatch]=useState<"all"|"any">("all");const [tags,setTags]=useState<RecipeTagSlug[]>([]);
  const [options,setOptions]=useState<IngredientOption[]>([]);const [optionsLoaded,setOptionsLoaded]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);const menuTrigger=useRef<HTMLButtonElement>(null);const mounted=useRef(true);
  const [error,setError]=useState<string|null>(null);const [savedPublicState,setSavedPublicState]=useState(new Map<string,boolean>());
  const knownBookmarkParents=useRef(new Map<string,string>());const copying=useRef(new Set<string>());const [copyingIds,setCopyingIds]=useState(new Set<string>());const [copyStatus,setCopyStatus]=useState("");
  const t=useT();const {language}=useI18n();const copy=useEditorialCopy();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search),180);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{
    if(mode!=="ingredients" || optionsLoaded)return;
    let cancelled=false;
    void webApiClient.recipes.ingredientOptions().then(value=>{if(!cancelled){setOptions(value);setOptionsLoaded(true);}}).catch(()=>{/* Typed entry remains available; retry on the next mode visit. */});
    return()=>{cancelled=true;};
  },[mode,optionsLoaded]);
  const filters=mode==="ingredients"?{ingredients,match,includeIngredients:true}:{q:debouncedSearch,tags};
  const minePage=useLibrarySearch("mine",filters,visited.has("mine"));
  const catalogPage=useLibrarySearch("catalog",filters,visited.has("catalog"));
  const allPage=useLibrarySearch("all",filters,visited.has("all"));
  const page=view==="mine"?minePage:view==="catalog"?catalogPage:allPage;
  const activeList=page.items;const loading=page.loading && !activeList.length;
  const highlightId=searchParams.get("highlight");
  const bookmarkParents=useMemo(()=>{
    const parents=new Map(knownBookmarkParents.current);
    for(const recipe of [...catalogPage.items,...allPage.items])if(recipe.catalog_source_recipe_id)parents.set(recipe.id,recipe.catalog_source_recipe_id);
    return parents;
  },[catalogPage.items,allPage.items]);
  function relatedBookmarks(first: string, second: string) {
    function ancestors(id: string) {
      const ids = new Set<string>();
      while (!ids.has(id)) {
        ids.add(id);
        const parent = bookmarkParents.get(id);
        if (!parent) break;
        id = parent;
      }
      return ids;
    }
    const firstIds = ancestors(first);
    return [...ancestors(second)].some(id => firstIds.has(id));
  }

  async function handleTogglePublicRecipe(recipeId: string, title: string, saved: boolean) {
    if ([...copying.current].some(id => relatedBookmarks(recipeId, id))) return;
    knownBookmarkParents.current = bookmarkParents;
    copying.current.add(recipeId);
    setCopyingIds(new Set(copying.current));
    setCopyStatus(`${t(saved ? "library.removing" : "library.adding")}: ${title}`);
    setError(null);
    try {
      const id = encodeURIComponent(recipeId);
      const response = await apiFetch(`/recipes/catalog/${id}/${saved ? "saved" : "copy"}`, { method: saved ? "DELETE" : "POST" });
      if (!response.ok) throw new Error((await response.text()) || "Could not add recipe");
      const result = response.status === 204 ? {} : await response.json();
      if (!mounted.current) return;
      setSavedPublicState(current => {
        const next = new Map(current).set(recipeId, !saved);
        for (const [id, value] of Object.entries(result.bookmark_states ?? {})) {
          if (typeof value === "boolean") next.set(id, value);
        }
        return next;
      });
      setCopyStatus(`${t(saved ? "library.removedFromLibrary" : "library.inYourLibrary")}: ${title}`);
      if (visited.has("mine")) void minePage.refresh();
      if (view !== "all" && visited.has("all")) void allPage.refresh();
      // Keep loaded catalog pages and focus; membership is patched above.
    } catch (caught) {
      if (!mounted.current) return;
      setCopyStatus("");
      setError(t(saved ? "library.removeError" : "library.copyError"));
    } finally {
      copying.current.delete(recipeId);
      if (mounted.current) setCopyingIds(new Set(copying.current));
    }
  }


  function collection(next:Collection){setView(next);setVisited(current=>new Set(current).add(next));}
  const hasFilters=mode==="ingredients"?ingredients.length>0:Boolean(search.trim()) || tags.length>0;
  const filterLabel=tags.length===0?t("recipe.filters.all"):tags.length===1?t(`recipe.tag.${tags[0]}`):t("recipe.filters.count",{count:tags.length});
  if(menuOpen)return <MenuMaker initialSearch={mode==="name"?search:""} initialFilters={mode==="name"?tags:[]} onClose={()=>{setMenuOpen(false);requestAnimationFrame(()=>menuTrigger.current?.focus());}} />;
  return <>
    <div className={styles.headingRow}>
      <PageHeader title={t("library.title")} description={copy["library.tagline"]} />
      <div className={styles.headingActions}>
        <Link href="/library/friends" className={styles.friendsLink}>{copy["library.friends"]}</Link>
        <button ref={menuTrigger} type="button" className={styles.menuButton} onClick={()=>setMenuOpen(true)}><Icon name="menuCard" size={18} />{t("menu.make")}</button>
      </div>
    </div>
    <div className={styles.collectionTabs} role="tablist" aria-label={t("library.views")} onKeyDown={event=>{
      const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==="ArrowRight"?(current+1)%3:event.key==="ArrowLeft"?(current+2)%3:event.key==="Home"?0:event.key==="End"?2:-1;
      if(next>=0){event.preventDefault();buttons[next].focus();buttons[next].click();}
    }}>
      {(["all","mine","catalog"] as const).map(scope=><button type="button" role="tab" key={scope} id={`collection-${scope}`} aria-controls="library-results" aria-selected={view===scope} tabIndex={view===scope?0:-1} className={styles.tab} onClick={()=>collection(scope)}>{t(scope==="all"?"library.allRecipes":scope==="mine"?"library.myLibrary":"library.publicLibrary")}</button>)}
    </div>
    <div className={styles.searchBar}>
      <label className={styles.modeSelector}><span className={styles.visuallyHidden}>{t("library.searchBy")}</span>
        <select value={mode} onChange={event=>setMode(event.target.value as "name"|"ingredients")}><option value="name">{t("library.recipeName")}</option><option value="ingredients">{t("library.ingredients.label")}</option></select>
      </label>
      <Icon name="search" size={18} />
      {mode==="name"?<input type="search" value={search} maxLength={200} aria-label={t("library.searchAria")} placeholder={t("library.searchPlaceholder")} onChange={event=>setSearch(event.target.value)} />:<IngredientSearch options={options} selected={ingredients} onAdd={name=>setIngredients(current=>current.includes(name) || current.length>=20?current:[...current,name])} />}
    </div>
    {mode==="ingredients"?<div className={styles.ingredientControls}>
      <div className={styles.selectedIngredients}>
        {ingredients.map(name=><button type="button" key={name} className={styles.ingredientChip} aria-label={t("library.ingredients.remove",{name:ingredientLabel(name,options,language)})} onClick={()=>setIngredients(current=>current.filter(value=>value!==name))}>{ingredientLabel(name,options,language)}<span aria-hidden="true">×</span></button>)}
        {ingredients.length?<button type="button" className={styles.clearIngredients} onClick={()=>setIngredients([])}>{t("library.ingredients.clear")}</button>:<p>{t("library.ingredients.hint")}</p>}
      </div>
      <div className={styles.matchControl} role="group" aria-label={t("library.ingredients.matchLabel")} aria-describedby="ingredient-match-help">
        <button type="button" aria-pressed={match==="all"} title={t("library.ingredients.allHelp")} onClick={()=>setMatch("all")}>{t("library.ingredients.matchAll")}</button><button type="button" aria-pressed={match==="any"} title={t("library.ingredients.anyHelp")} onClick={()=>setMatch("any")}>{t("library.ingredients.matchAny")}</button>
      </div>
      <span id="ingredient-match-help" className={styles.visuallyHidden}>{t(match==="all"?"library.ingredients.allHelp":"library.ingredients.anyHelp")}</span>
    </div>:null}
    <div id="library-results" role="tabpanel" aria-labelledby={`collection-${view}`} tabIndex={0} className={styles.resultsPanel}>
      <div className={styles.resultsToolbar}>
        <p aria-live="polite">{loading?t("common.loading"):page.total===undefined?t("library.resultsCount",{count:activeList.length}):t(page.total===1?"library.resultsCountOne":"library.resultsCount",{count:page.total})}</p>
        {mode==="name"?<TagFilterPopover values={tags} onToggleValue={tag=>setTags(current=>current.includes(tag)?current.filter(value=>value!==tag):[...current,tag])} onClear={()=>setTags([])} ariaLabel={t("library.filterAria")} triggerLabel={filterLabel} />:null}
      </div>
      <p className={styles.visuallyHidden} role="status">{copyStatus}</p>
      {error?<p className={styles.error} role="alert">{error}</p>:null}
      {page.error?<div className={styles.recovery}><div role="alert"><strong>{t("library.loadErrorTitle")}</strong><p>{t("library.loadErrorHelp")}</p></div><Button variant="secondary" loading={page.loading} onClick={()=>void page.refresh()}>{t("library.retry")}</Button></div>:null}
      {loading?<p className={styles.loadingRecipes}>{t("common.loading")}</p>:!activeList.length && page.error?null:!activeList.length?<div className={styles.empty}>
        <p>{hasFilters?t("common.noMatches"):view==="mine"?t("library.yourShelfReady"):t("library.publicShelfEmpty")}</p>
        <span className={styles.emptyDescription}>{hasFilters?mode==="ingredients"?t("library.ingredients.noMatchHelp"):t("library.tryAnotherFilter"):view==="mine"?t("library.firstRecipeHelp"):t("library.publicShelfEmptyDesc")}</span>
        <div className={styles.emptyActions}>
          {hasFilters?<Button variant="secondary" onClick={()=>{if(mode==="ingredients"){setIngredients([]);}else{setSearch("");setTags([]);}}}>{t("library.ingredients.clearFilters")}</Button>:view!=="catalog"?<><Button onClick={()=>collection("catalog")}>{t("library.browsePublic")}</Button><ActionLink href="/import" variant="secondary">{t("library.addRecipe")}</ActionLink></>:null}
          {mode==="ingredients" && ingredients.length>1 && match==="all"?<Button variant="ghost" onClick={()=>setMatch("any")}>{t("library.ingredients.tryAny")}</Button>:null}
        </div>
      </div>:<div className={styles.recipeGrid} role="list" aria-label={t("library.title")}>
        {activeList.map(recipe=>{
          const owned=recipe.is_owned;const href=owned?`/recipe/${encodeURIComponent(recipe.id)}`:`/library/public/${encodeURIComponent(recipe.id)}`;
          const alreadyAdded=savedPublicState.get(recipe.id)??Boolean(recipe.already_saved);
          return <article role="listitem" key={recipe.id} className={`${styles.resultCard}${highlightId===recipe.id?` ${styles.highlighted}`:""}`}>
            <Link href={href} className={styles.resultPhoto} tabIndex={-1} aria-hidden="true">{recipe.thumbnail_url?<img src={recipe.thumbnail_url} alt="" loading="lazy" />:<span className="cw-display">CW</span>}</Link>
            <div className={styles.resultCopy}>
              <Link href={href} className={styles.resultTitle}><h2 className="cw-display">{recipe.title}</h2></Link>
              <div className={styles.resultMetadata}><RecipeTiming {...recipe} /><span>{t(owned?"library.myLibrary":"library.publicLibrary")}</span></div>
              {mode==="ingredients" && recipe.remaining_ingredients?<RemainingIngredients names={recipe.remaining_ingredients} options={options} title={recipe.title} />:null}
              <Link href={href} className={styles.viewRecipe}>{t("library.viewRecipe")} <span aria-hidden="true">↗</span></Link>
            </div>
            {!owned || view==="catalog"?<PublicRecipeSaveButton title={recipe.title} saved={alreadyAdded} saving={[...copyingIds].some(id=>relatedBookmarks(recipe.id,id))} onSave={()=>void handleTogglePublicRecipe(recipe.id,recipe.title,alreadyAdded)} />:null}
          </article>;
        })}
      </div>}
      {page.next?<Button variant="secondary" loading={page.loading} onClick={()=>void page.more()} className={styles.loadMore}>{t("common.loadMoreRecipes")}</Button>:null}
    </div>
  </>;
}
export default function LibraryPage(){const {user}=useAuth();return <RequireAuth><PageShell><Suspense fallback={<p>Loading...</p>}><LibraryPageContent key={user?.id??"signed-out"} /></Suspense></PageShell></RequireAuth>;}
