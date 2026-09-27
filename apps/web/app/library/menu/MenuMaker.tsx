'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createMenuDraft, reconcileMenuSelection, type MenuDraft, type MenuFontAsset, type MenuLayout, type Recipe, type RecipeTagSlug } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import { MenuSelection } from './MenuSelection';
import { MenuEditor } from './MenuEditor';
import { MenuPreview, type MenuPreviewHandle } from './MenuPreview';
import { useMenuArtwork, type ArtworkCandidate } from './useMenuArtwork';
import { useMenuCreation } from './useMenuCreation';
import { useMenuPhotos } from './useMenuPhotos';
import { loadMenuFonts } from './menuAssets';
import { downloadMenuPng, printMenu } from './menuExport';
import styles from './MenuMaker.module.css';

type Props = { recipes: Recipe[]; initialSelectedIds: string[]; onClose: () => void; initialSearch?: string; initialFilters?: RecipeTagSlug[] };
export function MenuMaker({ recipes, initialSelectedIds, onClose, initialSearch, initialFilters }: Props) {
  const t = useT(); const [step, setStep] = useState<'selection'|'editor'>('selection');
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [draft, setDraft] = useState<MenuDraft>(() => {
    const initial = createMenuDraft(recipes,initialSelectedIds,{ title:t('menu.defaultTitle'), section:t('menu.defaultSection') });
    return { ...initial, design: initial.design ? { ...initial.design, show_descriptions: false } : undefined };
  });
  const [dirty, setDirty] = useState(false); const [revision, setRevision] = useState(0);
  const [fonts, setFonts] = useState<MenuFontAsset[] | null>(null); const [fontAttempt, setFontAttempt] = useState(0);
  const [artworkDataUrl, setArtworkDataUrl] = useState<string | null>(null);
  const [layoutState, setLayoutState] = useState<{ layout: MenuLayout; revision:number; images:Record<string,string> } | null>(null);
  const [page, setPage] = useState(0); const [error, setError] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const creation = useMenuCreation();
  const photos = useMenuPhotos(draft.items);
  const artwork = useMenuArtwork(); const preview = useRef<MenuPreviewHandle>(null); const heading = useRef<HTMLHeadingElement>(null);
  const pendingExport = useRef<{ revision:number; title:string; page:number } | null>(null); const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyGuard = useRef<{ marker:string; base:unknown } | null>(null);
  const guardGeneration = useRef(0);
  const leaveState = useRef({ dirty, onClose, t }); leaveState.current = { dirty, onClose, t };
  useEffect(() => {
    const generation = ++guardGeneration.current;
    historyGuard.current ??= { marker: `menu-${Date.now()}-${Math.random()}`, base: window.history.state };
    const { marker, base: original } = historyGuard.current;
    let guarded = true;
    if (window.history.state?.menuSession !== marker) window.history.pushState({ ...(original as object), menuSession: marker }, '', window.location.href);
    const permitted = () => !leaveState.current.dirty || window.confirm(`${leaveState.current.t('menu.unsaved.title')}\n\n${leaveState.current.t('menu.unsaved.sessionBody')}`);
    const back = () => {
      if (window.history.state?.menuSession === marker) return;
      if (permitted()) { guarded = false; leaveState.current.onClose(); }
      else window.history.pushState({ ...window.history.state, menuSession: marker }, '', window.location.href);
    };
    const navigate = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null;
      if (!target || target.target === '_blank' || target.hasAttribute('download') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || target.href === window.location.href) return;
      if (!permitted()) { event.preventDefault(); event.stopPropagation(); }
      else { guarded = false; window.history.replaceState(original, '', window.location.href); }
    };
    window.addEventListener('popstate', back); document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('popstate', back); document.removeEventListener('click', navigate, true);
      // Strict Mode immediately re-runs this effect. Defer cleanup and let that
      // newer generation retain the same history entry without a late popstate.
      queueMicrotask(() => {
        if (guardGeneration.current === generation && guarded && window.history.state?.menuSession === marker) window.history.back();
      });
    };
  }, []);
  const assets = useMemo(() => ({ fonts:fonts ?? [], artworkDataUrl, itemImages:photos.images }), [fonts,artworkDataUrl,photos.images]);
  // Only decoded assets reserve picture space. The original snapshot remains
  // untouched for photo loading, retry, and reconciliation with the library.
  const renderDraft = useMemo(() => ({ ...draft, items:draft.items.map(item => ({ ...item, imageUrl:photos.images[item.recipeId] ? 'menu-photo' : null })) }), [draft,photos.images]);
  useEffect(() => {
    pendingExport.current = null;
    if (exportTimer.current) clearTimeout(exportTimer.current);
    setExporting(false); setRevision(current => current + 1);
  }, [photos.images]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (step !== 'editor') return; let active = true; setError(null); void loadMenuFonts().then(value => { if(active) { setFonts(value); setRevision(current => current+1); } }).catch(() => { if(active) setError('menu.preview.failed'); }); return () => { active = false; }; }, [step,fontAttempt]);
  useEffect(() => { if(!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); }, [dirty]);
  useEffect(() => () => { if(exportTimer.current) clearTimeout(exportTimer.current); }, []);
  function update(next: MenuDraft) {
    if (pendingExport.current) {
      pendingExport.current = null;
      if (exportTimer.current) clearTimeout(exportTimer.current);
      setExporting(false);
    }
    setDraft(next); setDirty(true); setRevision(current => current+1); setError(null); }
  function accept(candidate: ArtworkCandidate) { setArtworkDataUrl(candidate.dataUrl); update({ ...draft,artwork:candidate.metadata }); artwork.discard(); }
  const valid = !!draft.title.trim() && draft.items.length > 0 && draft.items.every(item => !!item.name.trim());
  const ready = layoutState?.revision === revision && layoutState?.images === photos.images && !photos.loading;
  const pageCount = layoutState?.layout.pages.length ?? 1;
  function close() { if(!dirty || window.confirm(`${t('menu.unsaved.title')}\n\n${t('menu.unsaved.sessionBody')}`)) onClose(); }
  function png() {
    if(!ready || !valid || exporting) return;
    setError(null); setExporting(true); pendingExport.current = { revision,title:draft.title,page };
    exportTimer.current = setTimeout(() => { pendingExport.current = null; setExporting(false); setError('menu.export.failed'); }, 30_000);
    preview.current?.exportPng(page);
  }
  function receivePng(dataUrl: string, index: number) {
    const request = pendingExport.current;
    if(!request || request.revision !== revision || request.page !== index) return;
    try { downloadMenuPng(dataUrl,request.title,index); } catch { setError('menu.export.failed'); }
    finally { if(exportTimer.current) clearTimeout(exportTimer.current); pendingExport.current = null; setExporting(false); }
  }
  async function print() {
    if(!ready || !valid || !layoutState) return;
    setError(null); setExporting(true);
    try { await printMenu(layoutState.layout,renderDraft,assets); }
    catch(caught) { setError(caught instanceof Error && caught.message === 'popup-blocked' ? 'menu.export.popupBlocked' : 'menu.export.failed'); }
    finally { setExporting(false); }
  }
  async function continueEditing() {
    let next: MenuDraft;
    try { next = reconcileMenuSelection(draft, recipes, selectedIds); }
    catch { setError('menu.selection.missingRecipes'); return; }
    if (await creation.ensure()) { update(next); setStep('editor'); }
  }
  return <div className={styles.maker} data-testid="menu-maker">
    <header className={styles.header}><div><p className={styles.eyebrow}>CHEF WORLD · {t('menu.make')}</p><h1 className={styles.display} ref={heading} tabIndex={-1}>{step === 'selection' ? t('menu.make') : draft.title || t('menu.defaultTitle')}</h1></div><div className={styles.buttonRow}>{step === 'editor' ? <button type="button" onClick={() => setStep('selection')}><span aria-hidden="true">← </span>{t('menu.editor.back')}</button> : null}<button type="button" onClick={close} aria-label={t('menu.close')}>{t('menu.close')} ×</button></div></header>
    {step === 'selection' && <div className={styles.hint}>
      <p>{t(creation.access?.is_admin ? 'menu.creation.adminUnlimited' : 'menu.creation.dailyAllowance')}</p>
      {creation.access && !creation.access.is_admin && creation.access.allowed && <p>{t('menu.creation.remaining', { remaining: creation.access.remaining ?? 0, limit: creation.access.daily_limit ?? 1 })}</p>}
      {(creation.errorKey || creation.access?.allowed === false) && !creation.admitted && <p role="alert">{t(creation.errorKey ?? 'menu.creation.limitReached', { reset: creation.reset })}</p>}
      {(creation.errorKey === 'menu.creation.unavailable' || creation.access?.allowed === false && !creation.admitted) && <button type="button" onClick={() => void creation.refresh()}>{t('menu.retry')}</button>}
    </div>}
    {step === 'selection' ? <MenuSelection recipes={recipes} selectedIds={selectedIds} initialSearch={initialSearch} initialFilters={initialFilters} onChange={ids => {setSelectedIds(ids);setDirty(true);}} continueDisabled={!creation.canContinue} creating={creation.busy} onContinue={() => void continueEditing()} /> : <div className={styles.workspace}>
      <MenuEditor draft={draft} creationId={creation.requestId} photos={photos} onChange={update} artwork={artwork} onAccept={accept} onRemoveArtwork={() => { setArtworkDataUrl(null); update({ ...draft, artwork:null }); }} />
      <aside className={styles.previewColumn} aria-label={t('menu.preview.title')}>
        <div className={styles.previewHeader}><h2 className={styles.sectionTitle}>{t('menu.preview.title')}</h2><span className={styles.badge}>{t(draft.artwork ? 'menu.artwork.aiGenerated' : 'menu.studio.editable')}</span></div>
        <div className={styles.previewStage}>{fonts ? <MenuPreview ref={preview} draft={renderDraft} assets={assets} revision={revision} pageIndex={page} onReady={(layout,nextRevision) => {setLayoutState({layout,revision:nextRevision,images:photos.images});setPage(current => Math.min(current,layout.pages.length-1));}} onPng={receivePng} onError={code => { if(exportTimer.current) clearTimeout(exportTimer.current); pendingExport.current = null; setError(code === 'export-failed' ? 'menu.export.failed' : 'menu.preview.failed'); setExporting(false); }} /> : <div className={styles.previewLoading}>{t('menu.preview.loading')}</div>}</div>
        {photos.loading && <p className={styles.hint} role="status">{t('menu.studio.photosLoading')}</p>}
        <div className={styles.pagination}><button type="button" aria-label={t('menu.preview.previousPage')} disabled={page===0} onClick={() => setPage(page-1)}>←</button><span aria-live="polite">{t('menu.preview.pageOf',{current:page+1,total:pageCount})}</span><button type="button" aria-label={t('menu.preview.nextPage')} disabled={page===pageCount-1} onClick={() => setPage(page+1)}>→</button></div>
        {!valid ? <p className={styles.error} role="alert">{t('menu.editor.required')}</p> : null}
        {!ready && fonts && !error ? <p className={styles.hint} role="status">{t('menu.preview.loading')}</p> : null}
        <div className={styles.exportActions}><button type="button" className={styles.primary} disabled={!ready || !valid || exporting} onClick={png}>{t('menu.export.pngPage',{page:page+1})}</button><button type="button" className={styles.secondary} disabled={!ready || !valid || exporting} onClick={() => void print()}>{t('menu.export.printPdf')}</button></div>
        {exporting ? <p className={styles.hint} role="status">{t('menu.export.exporting')}</p> : null}
        {error ? <p className={styles.error} role="alert">{t(error)} {error === 'menu.preview.failed' ? <button type="button" onClick={() => {setFonts(null);setFontAttempt(value => value+1);}}>{t('menu.retry')}</button> : null}</p> : null}
      </aside>
    </div>}
    {step === 'selection' && error ? <p className={styles.error} role="alert">{t(error)}</p> : null}
  </div>;
}
