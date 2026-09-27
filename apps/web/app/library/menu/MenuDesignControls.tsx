import { useState } from 'react';
import { MENU_STYLES, menuDesignForStyle, resolveMenuDesign, type MenuDesign, type MenuDraft } from '@cooking/shared';
import { useI18n } from '../../lib/i18n';
import { useMenuDesign } from './useMenuDesign';
import styles from './MenuMaker.module.css';

const layouts: MenuDesign['layout'][] = ['photo-grid', 'category-board', 'illustrated-list'];
export function LayoutSwatch({ layout }: { layout: MenuDesign['layout'] }) {
  return <span className={styles.layoutSwatch} data-layout={layout} aria-hidden="true"><i /><span>{Array.from({ length: 6 }, (_, i) => <b key={i}><em /><small /></b>)}</span></span>;
}
type Props = { draft: MenuDraft; creationId: string; photoCount: number; onChange: (draft: MenuDraft) => void };
export function MenuDesignControls({ draft, creationId, photoCount, onChange }: Props) {
  const { t, language } = useI18n(); const ai = useMenuDesign();
  const [brief, setBrief] = useState('');
  const design = resolveMenuDesign(draft);
  const change = (patch: Partial<MenuDesign>) => onChange({ ...draft, design: { ...design, ...patch } });
  function selectLayout(layout: MenuDesign['layout']) {
    change({ layout, columns: layout === 'illustrated-list' ? 1 : layout === 'category-board' ? 3 : 2,
      section_treatment: layout === 'category-board' ? 'band' : layout === 'photo-grid' ? 'pill' : 'rule',
      photo_frame: layout === 'photo-grid' ? 'circle' : 'rounded',
      typography: { ...design.typography, align: layout === 'illustrated-list' ? 'left' : 'center' },
      artwork_placement: layout === 'illustrated-list' ? 'sidebar' : 'header',
    });
  }
  return <>
    <section className={`${styles.panel} ${styles.aiPanel}`}>
      <p className={styles.eyebrow}>✧ {t('menu.studio.aiLabel')}</p>
      <h2 className={styles.sectionTitle}>{t('menu.studio.brief')}</h2>
      <p className={styles.hint}>{t('menu.studio.aiHint')}</p>
      <label className={styles.field}><span className={styles.srOnly}>{t('menu.studio.brief')}</span><textarea rows={3} maxLength={1200} value={brief} placeholder={t('menu.studio.briefPlaceholder')} onChange={event => setBrief(event.target.value)} /></label>
      <div className={styles.buttonRow}><button type="button" className={styles.primary} disabled={ai.busy || !brief.trim()} onClick={() => void ai.generate({ menu_creation_id: creationId, brief: brief.trim(), content: { item_count: draft.items.length, section_count: draft.sections.length, photo_count: photoCount, language } })}>✧ {t(ai.busy ? 'menu.studio.generating' : 'menu.studio.generate')}</button>{ai.busy && <button type="button" onClick={ai.cancel}>{t('menu.artwork.cancel')}</button>}</div>
      {ai.errorKey && <p className={styles.error} role="alert">{t(ai.errorKey)}</p>}
      {ai.candidate && <div className={styles.designProposal} style={{ background: ai.candidate.palette.background, color: ai.candidate.palette.text }}>
        <LayoutSwatch layout={ai.candidate.layout} /><div><strong>{t('menu.studio.proposal')}</strong><p>{t(`menu.studio.layout.${ai.candidate.layout}`)} · {ai.candidate.columns} {t('menu.studio.columns').toLowerCase()}</p><div className={styles.paletteDots} aria-hidden="true">{Object.values(ai.candidate.palette).map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}</div></div>
        <div className={styles.buttonRow}><button type="button" className={styles.primary} onClick={() => { onChange({ ...draft, design: ai.candidate! }); ai.discard(); }}>{t('menu.studio.useProposal')}</button><button type="button" onClick={ai.discard}>{t('menu.studio.discardProposal')}</button></div>
      </div>}
    </section>
    <section className={styles.panel}>
      <fieldset className={styles.styleFieldset}><legend className={styles.sectionTitle}>{t('menu.studio.layout')}</legend><div className={styles.layoutOptions}>{layouts.map(layout => <button type="button" key={layout} aria-pressed={design.layout === layout} onClick={() => selectLayout(layout)}><LayoutSwatch layout={layout} /><span>{t(`menu.studio.layout.${layout}`)}</span></button>)}</div></fieldset>
      <fieldset className={styles.styleFieldset}><legend className={styles.controlLegend}>{t('menu.studio.palette')}</legend><div className={styles.paletteOptions}>{MENU_STYLES.map(style => { const preset = menuDesignForStyle(style.id); return <button type="button" key={style.id} title={t(style.labelKey)} aria-label={t(style.labelKey)} aria-pressed={Object.entries(preset.palette).every(([key, color]) => design.palette[key as keyof MenuDesign['palette']] === color)} onClick={() => onChange({ ...draft, styleId: style.id, design: { ...design, palette: preset.palette } })}><span className={styles.paletteDots} aria-hidden="true">{[preset.palette.background,preset.palette.panel,preset.palette.accent].map((color,index) => <i key={index} style={{ backgroundColor: color }} />)}</span></button>; })}</div></fieldset>
      <div className={styles.twoFields}><label className={styles.field}>{t('menu.studio.typography')}<select value={design.typography.title} onChange={event => change({ typography: { ...design.typography, title: event.target.value as MenuDesign['typography']['title'] } })}>{['playful','serif','sans'].map(value => <option key={value} value={value}>{t(`menu.studio.typography.${value}`)}</option>)}</select></label><label className={styles.field}>{t('menu.studio.columns')}<select value={design.columns} onChange={event => change({ columns: Number(event.target.value) as 1|2|3 })}>{[1,2,3].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <div className={styles.twoFields}><label className={styles.field}>{t('menu.studio.density')}<select value={design.density} onChange={event => change({ density: event.target.value as MenuDesign['density'] })}>{['airy','comfortable','compact'].map(value => <option key={value} value={value}>{t(`menu.studio.density.${value}`)}</option>)}</select></label><label className={styles.field}>{t('menu.studio.photoFrame')}<select value={design.photo_frame} onChange={event => change({ photo_frame: event.target.value as MenuDesign['photo_frame'] })}>{['circle','rounded','none'].map(value => <option key={value} value={value}>{t(`menu.studio.photoFrame.${value}`)}</option>)}</select></label></div>
      <label className={styles.checkField}><input type="checkbox" checked={design.show_descriptions} onChange={event => change({ show_descriptions: event.target.checked })} />{t('menu.studio.showDescriptions')}</label>
      <details className={styles.advanced}><summary>{t('menu.studio.fineTune')}</summary>
        <div className={styles.colorControls}>{(['background','panel','text','accent','muted'] as const).map(key => <label key={key}>{t(`menu.studio.color.${key}`)}<input type="color" value={design.palette[key]} onChange={event => change({ palette: { ...design.palette, [key]: event.target.value } })} /></label>)}</div>
        <div className={styles.twoFields}><label className={styles.field}>{t('menu.studio.decorations')}<select value={design.decorations} onChange={event => change({ decorations: event.target.value as MenuDesign['decorations'] })}>{['minimal','balanced','expressive'].map(value => <option key={value} value={value}>{t(`menu.studio.decorations.${value}`)}</option>)}</select></label><label className={styles.field}>{t('menu.studio.sectionTreatment')}<select value={design.section_treatment} onChange={event => change({ section_treatment: event.target.value as MenuDesign['section_treatment'] })}>{['plain','band','rule','pill'].map(value => <option key={value} value={value}>{t(`menu.studio.sectionTreatment.${value}`)}</option>)}</select></label></div>
        <div className={styles.twoFields}><label className={styles.field}>{t('menu.studio.bodyType')}<select value={design.typography.body} onChange={event => change({ typography: { ...design.typography, body: event.target.value as 'serif'|'sans' } })}>{['sans','serif'].map(value => <option key={value} value={value}>{t(`menu.studio.typography.${value}`)}</option>)}</select></label><label className={styles.field}>{t('menu.studio.alignment')}<select value={design.typography.align} onChange={event => change({ typography: { ...design.typography, align: event.target.value as 'left'|'center' } })}>{['left','center'].map(value => <option key={value} value={value}>{t(`menu.studio.alignment.${value}`)}</option>)}</select></label></div>
      </details>
    </section>
  </>;
}
