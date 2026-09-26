import { createMenuSection, moveMenuItem, updateMenuItem, type MenuDraft } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import { MenuStylePicker } from './MenuStylePicker';
import type { useMenuArtwork, ArtworkCandidate } from './useMenuArtwork';
import styles from './MenuMaker.module.css';

type Props = { draft: MenuDraft; onChange: (draft: MenuDraft) => void; artwork: ReturnType<typeof useMenuArtwork>; onAccept: (candidate: ArtworkCandidate) => void };
export function MenuEditor({ draft, onChange, artwork, onAccept }: Props) {
  const t = useT();
  function reorderSection(index: number, delta: number) { const sections = [...draft.sections]; [sections[index], sections[index + delta]] = [sections[index + delta], sections[index]]; onChange({ ...draft, sections }); }
  return <div className={styles.editorControls}>
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>{t('menu.editor.title')}</h2>
      <p className={styles.hint}>{t('menu.editor.localOnly')}</p>
      <label className={styles.field}>{t('menu.editor.menuTitle')}<input value={draft.title} aria-invalid={!draft.title.trim()} onChange={event => onChange({ ...draft, title: event.target.value })} /></label>
      <label className={styles.field}>{t('menu.editor.subtitle')}<input value={draft.subtitle} onChange={event => onChange({ ...draft, subtitle: event.target.value })} /></label>
    </section>
    <section className={styles.panel}><MenuStylePicker value={draft.styleId} onChange={styleId => onChange({ ...draft, styleId })} /></section>
    <section className={styles.panel}>
      <h2 className={styles.sectionTitle}>{t('menu.artwork.title')}</h2>
      <p className={styles.hint}>{t('menu.artwork.sharedAllowance')}</p>
      <label className={styles.field}>{t('menu.style.instructions')}<textarea aria-label={t('menu.style.instructions')} value={draft.instructions} maxLength={300} rows={2} placeholder={t('menu.style.instructionsPlaceholder')} onChange={event => onChange({ ...draft, instructions: event.target.value })} /><span className={styles.characterCount}>{draft.instructions.length} / 300</span></label>
      {artwork.access ? <p className={styles.hint}>{artwork.access.allowed ? t('menu.artwork.remaining', { remaining: artwork.access.remaining, limit: artwork.access.daily_limit }) : t(artwork.access.reason === 'daily_limit' ? 'menu.artwork.limitReached' : artwork.access.reason === 'global_limit' ? 'menu.artwork.globalLimit' : artwork.access.reason === 'membership_required' ? 'menu.artwork.membershipRequired' : 'menu.artwork.unavailable')}</p> : null}
      {artwork.errorKey ? <p role="alert" className={styles.error}>{t(artwork.errorKey)}</p> : null}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.secondary} disabled={artwork.busy || !artwork.access?.allowed} onClick={() => artwork.generate(draft.styleId, draft.instructions)}>{t(artwork.busy ? 'menu.artwork.generating' : artwork.candidate || draft.artwork ? 'menu.artwork.tryAnother' : 'menu.artwork.generate')}</button>
        {artwork.busy ? <button type="button" onClick={artwork.cancel}>{t('menu.artwork.cancel')}</button> : null}
        {artwork.recoverable ? <button type="button" disabled={artwork.busy} onClick={artwork.check}>{t('menu.artwork.checkAgain')}</button> : null}
      </div>
      {artwork.candidate ? <div className={styles.candidate}>
        <img src={artwork.candidate.dataUrl} alt={t('menu.artwork.aiGenerated')} />
        <div><span className={styles.badge}>{t('menu.artwork.aiGenerated')}</span><p>{t('menu.artwork.candidateStyle', { style: t(`menu.style.${artwork.candidate.metadata.styleId}`) })}</p><div className={styles.buttonRow}><button type="button" className={styles.primary} onClick={() => onAccept(artwork.candidate!)}>{t('menu.artwork.use')}</button><button type="button" onClick={artwork.discard}>{t('menu.artwork.discard')}</button></div></div>
      </div> : null}
      {draft.artwork ? <p className={styles.accepted}>✓ {t('menu.artwork.accepted')} <span>· {t(`menu.style.${draft.artwork.styleId}`)} · {t('menu.artwork.aiGenerated')}</span></p> : null}
    </section>
    <section className={styles.panel}>
      <div className={styles.sectionHeading}><h2 className={styles.sectionTitle}>{t('menu.defaultSection')}</h2><button type="button" onClick={() => onChange({ ...draft, sections:[...draft.sections, createMenuSection(t('menu.editor.newSection'))] })}>+ {t('menu.editor.addSection')}</button></div>
      {draft.sections.map((section, sectionIndex) => {
        const items = draft.items.filter(item => item.sectionId === section.id);
        return <section key={section.id} className={styles.dishSection} aria-label={section.title}>
          <div className={styles.sectionHeading}><label className={styles.field}>{t('menu.editor.sectionHeading')}<input value={section.title} onChange={event => onChange({ ...draft, sections: draft.sections.map(row => row.id === section.id ? { ...row, title: event.target.value } : row) })} /></label>
            <div className={styles.moveButtons}><button type="button" aria-label={`${t('menu.editor.moveUp')}: ${section.title}`} disabled={sectionIndex === 0} onClick={() => reorderSection(sectionIndex,-1)}>↑</button><button type="button" aria-label={`${t('menu.editor.moveDown')}: ${section.title}`} disabled={sectionIndex === draft.sections.length-1} onClick={() => reorderSection(sectionIndex,1)}>↓</button></div>
          </div>
          {items.map((item, index) => <div key={item.recipeId} className={styles.dishEditor}>
            <div className={styles.dishNumber} aria-hidden="true">{String(index + 1).padStart(2,'0')}</div>
            <div className={styles.dishFields}>
              <label className={styles.field}>{t('menu.editor.dishName')}<input value={item.name} aria-invalid={!item.name.trim()} onChange={event => onChange(updateMenuItem(draft,item.recipeId,{ name:event.target.value }))} /></label>
              <label className={styles.field}>{t('menu.editor.description')}<textarea value={item.description} rows={2} onChange={event => onChange(updateMenuItem(draft,item.recipeId,{ description:event.target.value }))} /></label>
              <div className={styles.itemActions}><label className={styles.sectionSelect}>{t('menu.editor.moveToSection')}<select aria-label={t('menu.editor.moveToSection')} value={item.sectionId} onChange={event => onChange(moveMenuItem(draft,item.recipeId,event.target.value,Number.MAX_SAFE_INTEGER))}>{draft.sections.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
                <div className={styles.moveButtons}><button type="button" aria-label={`${t('menu.editor.moveUp')}: ${item.name}`} disabled={index === 0} onClick={() => onChange(moveMenuItem(draft,item.recipeId,section.id,index-1))}>↑</button><button type="button" aria-label={`${t('menu.editor.moveDown')}: ${item.name}`} disabled={index === items.length-1} onClick={() => onChange(moveMenuItem(draft,item.recipeId,section.id,index+1))}>↓</button></div>
              </div>
            </div>
          </div>)}
        </section>;
      })}
    </section>
  </div>;
}
