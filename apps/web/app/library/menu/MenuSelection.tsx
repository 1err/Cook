import { useMemo, useState } from 'react';
import Link from 'next/link';
import { getRecipeTags, type Recipe, type RecipeTagSlug } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import { RecipeCard } from '../../components/RecipeCard';
import { TagFilterPopover } from '../../components/TagFilterPopover';
import { LibraryMasonry } from '../LibraryMasonry';
import styles from './MenuMaker.module.css';

type Props = { recipes: Recipe[]; selectedIds: string[]; onChange: (ids: string[]) => void; onContinue: () => void; continueDisabled?: boolean; creating?: boolean; initialSearch?: string; initialFilters?: RecipeTagSlug[] };
export function MenuSelection({ recipes, selectedIds, onChange, onContinue, continueDisabled = false, creating = false, initialSearch = '', initialFilters = [] }: Props) {
  const t = useT(); const [search, setSearch] = useState(initialSearch); const [tags, setTags] = useState(initialFilters);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const matching = useMemo(() => recipes.filter(recipe => recipe.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && tags.every(tag => getRecipeTags(recipe).includes(tag))).sort((a,b) => a.title.localeCompare(b.title)), [recipes, search, tags]);
  return <section aria-label={t('menu.selection.title')}>
    <div className={styles.selectionIntro}><div><h2 className={styles.display}>{t('menu.selection.title')}</h2><p className={styles.hint}>{t('menu.selection.description')}</p></div><p className={styles.count} aria-live="polite">{t('menu.selection.count', { count:selectedIds.length })}</p></div>
    <div className={styles.selectionToolbar}>
      <input className={styles.search} type="search" aria-label={t('library.searchAria')} placeholder={t('library.searchPlaceholder')} value={search} onChange={event => setSearch(event.target.value)} />
      <TagFilterPopover values={tags} onToggleValue={tag => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current,tag])} onClear={() => setTags([])} ariaLabel={t('library.filterAria')} />
    </div>
    <div className={styles.selectionActions}>
      <button type="button" onClick={() => onChange(recipes.map(recipe => recipe.id))}>{t('menu.selection.selectAll')}</button>
      <button type="button" onClick={() => onChange([...new Set([...selectedIds, ...matching.map(recipe => recipe.id)])])}>{t('menu.selection.selectMatching')}</button>
      <button type="button" onClick={() => onChange([])} disabled={!selectedIds.length}>{t('menu.selection.clear')}</button>
      <button type="button" className={styles.primary} disabled={!selectedIds.length || continueDisabled} onClick={onContinue}>{t(creating ? 'menu.creation.creating' : 'menu.selection.continue')} <span aria-hidden="true">→</span></button>
    </div>
    {!recipes.length ? <div className={styles.empty}><p>{t('menu.selection.empty')}</p><Link href="/import">{t('library.importRecipe')} <span aria-hidden="true">→</span></Link></div> : !matching.length ? <p className={styles.empty}>{t('common.noMatches')}</p> : <LibraryMasonry>
      {matching.map(recipe => <div key={recipe.id} className={styles.selectionCard} data-selected={selected.has(recipe.id)}>
        <label className={styles.selectionCheckbox}><input type="checkbox" checked={selected.has(recipe.id)} aria-label={t('menu.selection.selectDish', { name: recipe.title })} onChange={event => onChange(event.target.checked ? [...selectedIds,recipe.id] : selectedIds.filter(id => id !== recipe.id))} /><span>{recipe.title}</span></label>
        <RecipeCard recipe={recipe} />
      </div>)}
    </LibraryMasonry>}
  </section>;
}
