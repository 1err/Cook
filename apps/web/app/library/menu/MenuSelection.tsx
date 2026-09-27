import { useMemo, useState } from 'react';
import Link from 'next/link';
import { getRecipeTags, type Recipe, type RecipeTagSlug } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import { TagFilterPopover } from '../../components/TagFilterPopover';
import styles from './SimpleMenu.module.css';

type Props = { recipes:Recipe[]; selectedIds:string[]; onChange:(ids:string[]) => void; initialSearch?:string; initialFilters?:RecipeTagSlug[]; disabled?:boolean };
export function MenuSelection({ recipes,selectedIds,onChange,initialSearch='',initialFilters=[],disabled=false }:Props) {
 const t=useT(); const [search,setSearch]=useState(initialSearch); const [tags,setTags]=useState(initialFilters);
 const selected=useMemo(() => new Set(selectedIds),[selectedIds]);
 const matching=useMemo(() => recipes.filter(recipe => recipe.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && tags.every(tag => getRecipeTags(recipe).includes(tag))).sort((a,b) => a.title.localeCompare(b.title)),[recipes,search,tags]);
 return <section className={styles.selection} aria-label={t('menu.selection.title')}>
  <div className={styles.sectionHeading}><h2>{t('menu.selection.title')}</h2><span className={styles.count} aria-live="polite">{t('menu.selection.count',{ count:selectedIds.length })}</span></div>
  <div className={styles.searchRow}>
   <input type="search" aria-label={t('library.searchAria')} placeholder={t('library.searchPlaceholder')} value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} />
   {initialFilters.length > 0 && <TagFilterPopover values={tags} onToggleValue={tag => !disabled && setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current,tag])} onClear={() => !disabled && setTags([])} ariaLabel={t('library.filterAria')} />}
  </div>
  <div className={styles.selectionActions}><button type="button" disabled={disabled || !recipes.length} onClick={() => onChange([...new Set(recipes.map(recipe => recipe.id))])}>{t('menu.selection.selectAll')}</button><button type="button" disabled={disabled || !selectedIds.length} onClick={() => onChange([])}>{t('menu.selection.clear')}</button></div>
  {!recipes.length ? <div className={styles.empty}><p>{t('menu.selection.empty')}</p><Link href="/import">{t('library.importRecipe')}</Link></div> : !matching.length ? <p className={styles.empty}>{t('common.noMatches')}</p> : <div className={styles.recipeList}>
   {matching.map(recipe => <label key={recipe.id} className={styles.recipeRow} data-selected={selected.has(recipe.id)}>
    <input type="checkbox" checked={selected.has(recipe.id)} disabled={disabled} aria-label={t('menu.selection.selectDish',{ name:recipe.title })} onChange={event => onChange(event.target.checked ? [...new Set([...selectedIds,recipe.id])] : selectedIds.filter(id => id !== recipe.id))} />
    {recipe.thumbnail_url ? <img src={recipe.thumbnail_url} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" /> : <span className={styles.thumbnailPlaceholder} aria-hidden="true">{recipe.title.trim().slice(0,1)}</span>}
    <span className={styles.recipeName}>{recipe.title}</span>
   </label>)}
  </div>}
 </section>;
}
