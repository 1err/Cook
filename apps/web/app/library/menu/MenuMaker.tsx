'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FULL_MENU_RECIPE_LIMIT } from '@cooking/api-client';
import type { Recipe, RecipeTagSlug } from '@cooking/shared';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { MenuSelection } from './MenuSelection';
import { useGeneratedMenu } from './useGeneratedMenu';
import styles from './SimpleMenu.module.css';

type Props = { recipes:Recipe[]; initialSelectedIds:string[]; onClose:() => void; initialSearch?:string; initialFilters?:RecipeTagSlug[]; onRefreshRecipes?:(signal:AbortSignal) => Promise<Recipe[]> };
export function MenuMaker(props:Props) {
 const { user }=useAuth();
 // A different account must never inherit another account's choices or image.
 return <MenuForm key={user?.id ?? 'signed-out'} {...props} />;
}
function MenuForm({ recipes,initialSelectedIds,onClose,initialSearch,initialFilters,onRefreshRecipes }:Props) {
 const t=useT(); const [selectedIds,setSelectedIds]=useState(() => [...new Set(initialSelectedIds)]);
 const [title,setTitle]=useState(''); const [brief,setBrief]=useState('');
 const [refreshing,setRefreshing]=useState(false); const [refreshError,setRefreshError]=useState(false);
 const recipeRefresh=useRef<AbortController | null>(null);
 useEffect(() => () => { const pending=recipeRefresh.current; recipeRefresh.current=null; pending?.abort(); },[]);
 const [downloaded,setDownloaded]=useState<string | null>(null);
 const generation=useGeneratedMenu(); const heading=useRef<HTMLHeadingElement>(null);
 const locked=generation.busy || generation.recoverable || refreshing;
 const dirty=locked || !!generation.result && downloaded !== generation.result.requestId;
 const leaveState=useRef({ dirty,onClose,t }); leaveState.current={ dirty,onClose,t };
 const historyGuard=useRef<{ marker:string; base:unknown } | null>(null); const guardEpoch=useRef(0);
 useEffect(() => { heading.current?.focus(); },[]);
 useEffect(() => {
  const epoch=++guardEpoch.current; historyGuard.current ??= { marker:`menu-${Date.now()}-${Math.random()}`,base:window.history.state };
  const { marker,base }=historyGuard.current; let guarded=true;
  if (window.history.state?.menuSession !== marker) window.history.pushState({ ...(base as object),menuSession:marker },'',window.location.href);
  const allowed=() => !leaveState.current.dirty || window.confirm(`${leaveState.current.t('menu.unsaved.title')}\n\n${leaveState.current.t('menu.unsaved.sessionBody')}`);
  const back=() => { if (window.history.state?.menuSession === marker) return; if (allowed()) { guarded=false; leaveState.current.onClose(); } else window.history.pushState({ ...window.history.state,menuSession:marker },'',window.location.href); };
  const navigate=(event:MouseEvent) => {
   const target=event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
   if (!target || target.target === '_blank' || target.hasAttribute('download') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || target.href === window.location.href) return;
   if (!allowed()) { event.preventDefault(); event.stopPropagation(); } else { guarded=false; window.history.replaceState(base,'',window.location.href); }
  };
  window.addEventListener('popstate',back); document.addEventListener('click',navigate,true);
  return () => { window.removeEventListener('popstate',back); document.removeEventListener('click',navigate,true); queueMicrotask(() => { if (guardEpoch.current === epoch && guarded && window.history.state?.menuSession === marker) window.history.back(); }); };
 },[]);
 useEffect(() => {
  if (!dirty) return;
  const warn=(event:BeforeUnloadEvent) => { event.preventDefault(); event.returnValue=''; };
  window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn);
 },[dirty]);
 const recipesById=useMemo(() => new Map(recipes.map(recipe => [recipe.id,recipe])),[recipes]);
 const selected=selectedIds.map(id => recipesById.get(id));
 const missing=selected.some(recipe => !recipe);
 const tooMany=selectedIds.length > FULL_MENU_RECIPE_LIMIT;
 const reset=generation.access?.resets_at ? new Date(generation.access.resets_at).toLocaleString() : '';
 const accessError=generation.accessError ?? (generation.access?.allowed === false && !generation.result && !locked ? 'menu.creation.limitReached' : generation.artworkAccess?.allowed === false && !locked ? generation.artworkAccess.reason === 'membership_required' ? 'menu.simple.membershipRequired' : generation.artworkAccess.reason === 'daily_limit' ? 'menu.simple.imageLimit' : 'menu.simple.unavailable' : null);
 const error=refreshError ? 'menu.selection.loadFailed' : generation.errorKey ?? accessError;
 async function refreshRecipes() {
  if (!onRefreshRecipes || recipeRefresh.current) return;
  const controller=new AbortController(); recipeRefresh.current=controller; setRefreshing(true); setRefreshError(false);
  let timeout:ReturnType<typeof setTimeout> | undefined; let abort:() => void=() => {};
  const cancelled=new Promise<never>((_,reject) => { abort=() => reject(new Error('Recipe refresh ended')); controller.signal.addEventListener('abort',abort,{ once:true }); timeout=setTimeout(() => controller.abort(),30_000); });
  try {
   const rows=await Promise.race([onRefreshRecipes(controller.signal),cancelled]);
   if (controller.signal.aborted) return;
   const available=new Set(rows.map(recipe => recipe.id)); setSelectedIds(current => current.filter(id => available.has(id))); generation.selectionRefreshed();
  } catch { if (recipeRefresh.current === controller) setRefreshError(true); }
  finally { clearTimeout(timeout); controller.signal.removeEventListener('abort',abort); if (recipeRefresh.current === controller) { recipeRefresh.current=null; setRefreshing(false); } }
 }
 function submit() {
  if (generation.recoverable) { generation.check(); return; }
  if (refreshing || !generation.canGenerate || missing || tooMany || !selected.length) return;
  generation.generate({ title:title.trim(),brief:brief.trim(),recipes:selected.map(recipe => ({ recipe_id:recipe!.id,name:recipe!.title })) });
 }
 function close() { if (!dirty || window.confirm(`${t('menu.unsaved.title')}\n\n${t('menu.unsaved.sessionBody')}`)) onClose(); }
 const filename=(generation.result?.title || t('menu.defaultTitle')).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().replace(/\s+/g,'-').slice(0,80) || 'menu';
 return <div className={styles.maker} data-testid="menu-maker">
  <header className={styles.header}><div><p className={styles.eyebrow}>CHEF WORLD</p><h1 ref={heading} tabIndex={-1}>{t('menu.make')}</h1><p className={styles.intro}>{t('menu.simple.intro')}</p></div><button type="button" className={styles.close} onClick={close} aria-label={t('menu.close')}>{t('menu.close')} <span aria-hidden="true">×</span></button></header>
  <form className={styles.form} onSubmit={event => { event.preventDefault(); submit(); }}>
   <fieldset className={styles.fields} disabled={locked}>
    <MenuSelection recipes={recipes} selectedIds={selectedIds} initialSearch={initialSearch} initialFilters={initialFilters} onChange={setSelectedIds} disabled={locked} />
    <div className={styles.prompt}>
     <label className={styles.field}><span>{t('menu.simple.title')}</span><input value={title} maxLength={120} placeholder={t('menu.simple.titlePlaceholder')} onChange={event => setTitle(event.target.value)} /></label>
     <label className={styles.field}><span>{t('menu.simple.brief')}</span><textarea value={brief} maxLength={1200} rows={5} placeholder={t('menu.simple.briefPlaceholder')} onChange={event => setBrief(event.target.value)} /></label>
     <p className={styles.promptHint}>{t('menu.simple.readyHint')}</p>
    </div>
   </fieldset>
   {tooMany && <p className={styles.error} role="alert">{t('menu.simple.recipeLimit',{ limit:FULL_MENU_RECIPE_LIMIT })}</p>}
   {missing && <p className={styles.error} role="alert">{t('menu.selection.missingRecipes')}</p>}
   <div className={styles.formFooter}>
    <p className={styles.allowance}>{t(generation.access?.is_admin ? 'menu.creation.adminUnlimited' : 'menu.simple.dailyAllowance')}</p>
    <div className={styles.actions}>
     {generation.busy && <button type="button" onClick={generation.cancel}>{t('menu.simple.cancel')}</button>}
     <button type="submit" className={styles.generate} disabled={generation.busy || refreshing || !generation.recoverable && (!generation.canGenerate || !selected.length || tooMany || missing)}>{generation.busy ? <><span className={styles.spinner} aria-hidden="true" />{t(generation.checkingResult ? 'menu.simple.checking' : 'menu.simple.generating')}</> : <><span aria-hidden="true">✦</span>{t(generation.recoverable ? 'menu.simple.check' : 'menu.simple.generate')}</>}</button>
    </div>
   </div>
   {generation.checkingAccess && !generation.busy && !generation.result && <p className={styles.status} role="status">{t('menu.simple.quotaChecked')}</p>}
   {generation.busy && <p className={styles.status} role="status">{t(generation.checkingResult ? 'menu.simple.checking' : 'menu.simple.generating')}</p>}
   {generation.recoverable && <p className={styles.status} role="status">{t('menu.simple.waiting')}</p>}
   {error && <p className={styles.error} role="alert">{t(error,{ reset })}{(generation.errorKey === 'menu.simple.selectionChanged' || refreshError) && onRefreshRecipes && <button type="button" disabled={refreshing} onClick={() => void refreshRecipes()}>{t(refreshing ? 'common.loading' : 'common.refresh')}</button>}{generation.accessError && !generation.busy && <button type="button" onClick={() => void generation.refresh()}>{t('menu.retry')}</button>}</p>}
  </form>
  {generation.result && <section className={styles.result} aria-label={t('menu.simple.result')}>
   <div className={styles.resultHeading}><div><h2>{t('menu.simple.result')}</h2><p>{t('menu.simple.resultNote')}</p></div><a className={styles.download} href={generation.result.dataUrl} download={`${filename}.png`} onClick={() => setDownloaded(generation.result!.requestId)}>{t('menu.simple.download')} <span aria-hidden="true">↓</span></a></div>
   <img className={styles.resultImage} src={generation.result.dataUrl} alt={t('menu.simple.imageAlt')} />
  </section>}
 </div>;
}
