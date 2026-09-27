import { useState } from 'react';
import { createMenuSection, moveMenuItem, resolveMenuDesign, updateMenuItem, type MenuDraft } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import { MenuDesignControls } from './MenuDesignControls';
import type { useMenuPhotos } from './useMenuPhotos';
import type { useMenuArtwork, ArtworkCandidate } from './useMenuArtwork';
import styles from './MenuMaker.module.css';

type Props = { draft: MenuDraft; creationId: string; photos: ReturnType<typeof useMenuPhotos>; onChange: (draft: MenuDraft) => void; artwork: ReturnType<typeof useMenuArtwork>; onAccept: (candidate: ArtworkCandidate) => void; onRemoveArtwork: () => void };
export function MenuEditor({ draft, creationId, photos, onChange, artwork, onAccept, onRemoveArtwork }: Props) {
  const t = useT(); const [tab, setTab] = useState<'design'|'dishes'>('design');
  const design = resolveMenuDesign(draft);
  function reorderSection(index: number, delta: number) { const sections = [...draft.sections]; [sections[index], sections[index + delta]] = [sections[index + delta], sections[index]]; onChange({ ...draft, sections }); }
  return <div className={styles.editorControls}>
    <div className={styles.editorTabs} role="tablist" aria-label={t('menu.studio.title')}><button type="button" role="tab" id="menu-design-tab" aria-controls="menu-design-panel" aria-selected={tab === 'design'} onClick={() => setTab('design')}>{t('menu.studio.designTab')}</button><button type="button" role="tab" id="menu-dishes-tab" aria-controls="menu-dishes-panel" aria-selected={tab === 'dishes'} onClick={() => setTab('dishes')}>{t('menu.studio.dishesTab')} <span>{draft.items.length}</span></button></div>
    <div role="tabpanel" id="menu-design-panel" aria-labelledby="menu-design-tab" hidden={tab !== 'design'} className={styles.tabPanel}>
    <MenuDesignControls draft={draft} creationId={creationId} photoCount={Object.keys(photos.images).length} onChange={onChange} />
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>{t('menu.editor.title')}</h2>
      <p className={styles.hint}>{t('menu.editor.localOnly')}</p>
      <label className={styles.field}>{t('menu.editor.menuTitle')}<input value={draft.title} aria-invalid={!draft.title.trim()} onChange={event => onChange({ ...draft, title: event.target.value })} /></label>
      <label className={styles.field}>{t('menu.editor.subtitle')}<input value={draft.subtitle} onChange={event => onChange({ ...draft, subtitle: event.target.value })} /></label>
    </section>
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>{t('menu.artwork.title')}</h2>
      <p className={styles.hint}>{t('menu.artwork.sharedAllowance')}</p>
      <label className={styles.field}>{t('menu.studio.artDirection')}<textarea value={design.art_direction} maxLength={600} rows={2} placeholder={t('menu.studio.artDirectionPlaceholder')} onChange={event => onChange({ ...draft, design: { ...design, art_direction: event.target.value } })} /></label>
      <label className={styles.field}>{t('menu.studio.artPlacement')}<select value={design.artwork_placement} onChange={event => onChange({ ...draft, design: { ...design, artwork_placement: event.target.value as typeof design.artwork_placement } })}>{['header','sidebar','inset'].map(value => <option key={value} value={value}>{t(`menu.studio.artPlacement.${value}`)}</option>)}</select></label>
      <label className={styles.field}>{t('menu.style.instructions')}<textarea aria-label={t('menu.style.instructions')} value={draft.instructions} maxLength={300} rows={2} placeholder={t('menu.style.instructionsPlaceholder')} onChange={event => onChange({ ...draft, instructions: event.target.value })} /><span className={styles.characterCount}>{draft.instructions.length} / 300</span></label>
      {artwork.access ? <p className={styles.hint}>{artwork.access.allowed ? t('menu.artwork.remaining', { remaining: artwork.access.remaining, limit: artwork.access.daily_limit }) : t(artwork.access.reason === 'daily_limit' ? 'menu.artwork.limitReached' : artwork.access.reason === 'global_limit' ? 'menu.artwork.globalLimit' : artwork.access.reason === 'membership_required' ? 'menu.artwork.membershipRequired' : 'menu.artwork.unavailable')}</p> : null}
      {artwork.errorKey ? <p role="alert" className={styles.error}>{t(artwork.errorKey)}</p> : null}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.secondary} disabled={artwork.busy || !artwork.access?.allowed} onClick={() => artwork.generate(draft.styleId, draft.instructions, design)}>{t(artwork.busy ? 'menu.artwork.generating' : artwork.candidate || draft.artwork ? 'menu.artwork.tryAnother' : 'menu.artwork.generate')}</button>
        {artwork.busy ? <button type="button" onClick={artwork.cancel}>{t('menu.artwork.cancel')}</button> : null}
        {artwork.recoverable ? <button type="button" disabled={artwork.busy} onClick={artwork.check}>{t('menu.artwork.checkAgain')}</button> : null}
      </div>
      {artwork.candidate ? <div className={styles.candidate}>
        <img src={artwork.candidate.dataUrl} alt={t('menu.artwork.aiGenerated')} />
        <div><span className={styles.badge}>{t('menu.artwork.aiGenerated')}</span><p>{t('menu.artwork.candidateStyle', { style: t(`menu.style.${artwork.candidate.metadata.styleId}`) })}</p><div className={styles.buttonRow}><button type="button" className={styles.primary} onClick={() => onAccept(artwork.candidate!)}>{t('menu.artwork.use')}</button><button type="button" onClick={artwork.discard}>{t('menu.artwork.discard')}</button></div></div>
      </div> : null}
      {draft.artwork ? <p className={styles.accepted}>✓ {t('menu.artwork.accepted')} <button type="button" onClick={onRemoveArtwork}>{t('menu.studio.removeArt')}</button></p> : null}
    </section>
    </div>
    <div role="tabpanel" id="menu-dishes-panel" aria-labelledby="menu-dishes-tab" hidden={tab !== 'dishes'} className={styles.tabPanel}>
    <section className={styles.panel}>
      <p className={styles.hint}>{t('menu.studio.photosHint')}</p>
      {photos.loading && <p className={styles.hint} role="status">{t('menu.studio.photosLoading')}</p>}
      {Object.keys(photos.errors).length > 0 && <p className={styles.hint}>{t('menu.studio.photosUnavailable')} <button type="button" onClick={photos.retry}>{t('menu.studio.retryPhotos')}</button></p>}
      <div className={styles.sectionHeading}><h2 className={styles.sectionTitle}>{t('menu.defaultSection')}</h2><button type="button" onClick={() => onChange({ ...draft, sections:[...draft.sections, createMenuSection(t('menu.editor.newSection'))] })}>+ {t('menu.editor.addSection')}</button></div>
      {draft.sections.map((section, sectionIndex) => {
        const items = draft.items.filter(item => item.sectionId === section.id);
        return <section key={section.id} className={styles.dishSection} aria-label={section.title}>
          <div className={styles.sectionHeading}><label className={styles.field}>{t('menu.editor.sectionHeading')}<input value={section.title} onChange={event => onChange({ ...draft, sections: draft.sections.map(row => row.id === section.id ? { ...row, title: event.target.value } : row) })} /></label>
            <div className={styles.moveButtons}><button type="button" aria-label={`${t('menu.editor.moveUp')}: ${section.title}`} disabled={sectionIndex === 0} onClick={() => reorderSection(sectionIndex,-1)}>↑</button><button type="button" aria-label={`${t('menu.editor.moveDown')}: ${section.title}`} disabled={sectionIndex === draft.sections.length-1} onClick={() => reorderSection(sectionIndex,1)}>↓</button></div>
          </div>
          {items.map((item, index) => <details key={item.recipeId} className={styles.dishEditor}>
            <summary className={styles.dishSummary}>{photos.images[item.recipeId] ? <img src={photos.images[item.recipeId]} alt="" /> : <span className={styles.dishPlaceholder} aria-hidden="true">{String(index + 1).padStart(2,'0')}</span>}<span>{item.name || t('menu.editor.dishName')}<small>{item.price || item.badge || t('menu.studio.editDish')}</small></span><b aria-hidden="true">＋</b></summary>
            <div className={styles.dishFields}>
              <label className={styles.field}>{t('menu.editor.dishName')}<input value={item.name} aria-invalid={!item.name.trim()} onChange={event => onChange(updateMenuItem(draft,item.recipeId,{ name:event.target.value }))} /></label>
              <label className={styles.field}>{t('menu.editor.description')}<textarea value={item.description} rows={2} onChange={event => onChange(updateMenuItem(draft,item.recipeId,{ description:event.target.value }))} /></label>
              <div className={styles.twoFields}><label className={styles.field}>{t('menu.studio.price')}<input value={item.price ?? ''} maxLength={40} placeholder={t('menu.studio.pricePlaceholder')} onChange={event => onChange(updateMenuItem(draft,item.recipeId,{ price:event.target.value }))} /></label><label className={styles.field}>{t('menu.studio.badge')}<input value={item.badge ?? ''} maxLength={80} placeholder={t('menu.studio.badgePlaceholder')} onChange={event => onChange(updateMenuItem(draft,item.recipeId,{ badge:event.target.value }))} /></label></div>
              <label className={styles.field}>{t('menu.studio.uploadPhoto')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void photos.upload(item.recipeId,file).catch(() => {}); }} /></label>
              {photos.errors[item.recipeId] && <p className={styles.error} role="alert">{t('menu.photos.failed')}</p>}
              {photos.images[item.recipeId] && <button type="button" className={styles.photoRemove} onClick={() => photos.remove(item.recipeId)}>{t('menu.studio.removePhoto')}</button>}
              <div className={styles.itemActions}><label className={styles.sectionSelect}>{t('menu.editor.moveToSection')}<select aria-label={t('menu.editor.moveToSection')} value={item.sectionId} onChange={event => onChange(moveMenuItem(draft,item.recipeId,event.target.value,Number.MAX_SAFE_INTEGER))}>{draft.sections.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
                <div className={styles.moveButtons}><button type="button" aria-label={`${t('menu.editor.moveUp')}: ${item.name}`} disabled={index === 0} onClick={() => onChange(moveMenuItem(draft,item.recipeId,section.id,index-1))}>↑</button><button type="button" aria-label={`${t('menu.editor.moveDown')}: ${item.name}`} disabled={index === items.length-1} onClick={() => onChange(moveMenuItem(draft,item.recipeId,section.id,index+1))}>↓</button></div>
              </div>
            </div>
          </details>)}
        </section>;
      })}
    </section>
    </div>
  </div>;
}
