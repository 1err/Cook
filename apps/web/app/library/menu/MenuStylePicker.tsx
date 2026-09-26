import { MENU_STYLES, type MenuStyleId } from '@cooking/shared';
import { useT } from '../../lib/i18n';
import styles from './MenuMaker.module.css';

export function MenuStylePicker({ value, onChange }: { value: MenuStyleId; onChange: (style: MenuStyleId) => void }) {
  const t = useT();
  return <fieldset className={styles.styleFieldset}>
    <legend className={styles.sectionTitle}>{t('menu.style.title')}</legend>
    <p className={styles.hint}>{t('menu.style.description')}</p>
    <div className={styles.styleGrid}>
      {MENU_STYLES.map(style => <label key={style.id} className={styles.styleOption} data-selected={value === style.id}>
        <input type="radio" name="menu-style" value={style.id} checked={value === style.id} onChange={() => onChange(style.id)} />
        <span className={styles.styleSample} style={{ backgroundColor: style.colors.background, color: style.colors.text, textAlign: style.titleAlign }} aria-hidden="true">
          <span className={styles.sampleOrnament} dangerouslySetInnerHTML={{ __html: style.ornamentSvg }} />
          <span className={styles.samplePaper} style={{ backgroundColor: style.colors.panel, fontFamily: style.titleFamily === 'MenuSerif' ? 'var(--cw-font-display, Georgia), serif' : 'inherit' }}>
            <strong>{t('menu.defaultTitle')}</strong><i style={{ backgroundColor: style.colors.accent }} /><span /> <span /> <span />
          </span>
        </span>
        <span>{t(style.labelKey)}</span>
      </label>)}
    </div>
  </fieldset>;
}
