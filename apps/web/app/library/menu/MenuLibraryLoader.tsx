'use client';
import { useEffect, useRef, useState } from 'react';
import type { Recipe, RecipeTagSlug } from '@cooking/shared';
import { webApiClient } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { MenuMaker } from './MenuMaker';
import styles from './MenuMaker.module.css';

/** Menu selection needs the whole library, independently of the browsing page. */
export function MenuLibraryLoader({ onClose, initialSearch, initialFilters }: {
  onClose: () => void;
  initialSearch?: string;
  initialFilters?: RecipeTagSlug[];
}) {
  const t = useT();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function refreshRecipes(signal: AbortSignal): Promise<Recipe[]> {
    const rows = await webApiClient.recipes.list();
    if (!mounted.current || signal.aborted) throw new Error('Recipe refresh cancelled');
    setRecipes(rows);
    return rows;
  }
  useEffect(() => {
    let active = true;
    setFailed(false);
    void webApiClient.recipes.list().then(rows => {
      if (active) setRecipes(rows);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  if (recipes) return <MenuMaker recipes={recipes} initialSelectedIds={[]} initialSearch={initialSearch} initialFilters={initialFilters} onClose={onClose} onRefreshRecipes={refreshRecipes} />;
  return <div className={styles.maker}>
    <header className={styles.header}><h1>{t('menu.make')}</h1><button type="button" onClick={onClose}>{t('menu.close')} ×</button></header>
    {failed ? <div><p role="alert">{t('menu.selection.loadFailed')}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>{t('menu.retry')}</button></div> : <p role="status">{t('common.loading')}</p>}
  </div>;
}
