import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { MenuDesign } from '@cooking/shared';
import { TextField } from '../../components';
import { useT } from '../../lib/i18n';
import { colors, radii, spacing, typography } from '../../theme';

type Props = { design: MenuDesign; onChange: (design: MenuDesign) => void };
function LayoutThumbnail({ layout, color }: { layout: MenuDesign['layout']; color: string }) {
  return <View style={styles.thumbnail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={[styles.titleLine, { backgroundColor: color }]} />
    <View style={[styles.miniContent, layout === 'illustrated-list' && styles.miniList]}>
      {Array.from({ length: layout === 'illustrated-list' ? 3 : 6 }, (_, index) => <View key={index} style={[
        layout === 'category-board' ? styles.miniPanel : layout === 'illustrated-list' ? styles.miniRow : styles.miniDish,
        { backgroundColor: color, opacity: .35 + (index % 3) * .17 },
        layout === 'category-board' && index % 2 === 0 && { height: 28 },
      ]} />)}
    </View>
  </View>;
}
export function MenuDesignControls({ design, onChange }: Props) {
  const t = useT();
  const choices = <T extends string | number,>(title: string, value: T, options: readonly T[], change: (value: T) => void, prefix?: string) => <View style={styles.group}>
    <Text style={styles.label}>{t(title)}</Text><View style={styles.row}>{options.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: value === option }} accessibilityLabel={prefix ? t(`${prefix}.${option}`) : `${t(title)} ${option}`} onPress={() => change(option)} style={[styles.chip, value === option && styles.selected]}>
      <Text style={styles.chipText}>{prefix ? t(`${prefix}.${option}`) : option}</Text>
    </Pressable>)}</View>
  </View>;
  return <View>
    <Text style={styles.label}>{t('menu.studio.layout')}</Text>
    <View style={styles.row}>{(['photo-grid', 'category-board', 'illustrated-list'] as const).map(layout => <Pressable key={layout} accessibilityRole="radio" accessibilityState={{ checked: design.layout === layout }} accessibilityLabel={t(`menu.studio.layout.${layout}`)} onPress={() => onChange({ ...design, layout, columns: layout === 'illustrated-list' ? 1 : layout === 'category-board' ? 3 : 2, section_treatment: layout === 'category-board' ? 'band' : layout === 'illustrated-list' ? 'rule' : 'pill', photo_frame: layout === 'photo-grid' ? 'circle' : 'rounded', typography: { ...design.typography, align: layout === 'illustrated-list' ? 'left' : 'center' }, artwork_placement: layout === 'illustrated-list' ? 'sidebar' : 'header' })} style={[styles.layoutOption, design.layout === layout && styles.selected]}>
      <LayoutThumbnail layout={layout} color={design.palette.accent} /><Text style={styles.layoutLabel}>{t(`menu.studio.layout.${layout}`)}</Text>
    </Pressable>)}</View>
    {choices('menu.studio.columns', design.columns, [1, 2, 3] as const, columns => onChange({ ...design, columns }))}
    {choices('menu.studio.density', design.density, ['airy', 'comfortable', 'compact'] as const, density => onChange({ ...design, density }), 'menu.studio.density')}
    {choices('menu.studio.typography', design.typography.title, ['serif', 'sans', 'playful'] as const, title => onChange({ ...design, typography: { ...design.typography, title } }), 'menu.studio.typography')}
    {choices('menu.studio.bodyType', design.typography.body, ['serif', 'sans'] as const, body => onChange({ ...design, typography: { ...design.typography, body } }), 'menu.studio.typography')}
    {choices('menu.studio.alignment', design.typography.align, ['left', 'center'] as const, align => onChange({ ...design, typography: { ...design.typography, align } }), 'menu.studio.alignment')}
    {choices('menu.studio.sectionTreatment', design.section_treatment, ['plain', 'band', 'rule', 'pill'] as const, section_treatment => onChange({ ...design, section_treatment }), 'menu.studio.sectionTreatment')}
    {choices('menu.studio.photoFrame', design.photo_frame, ['none', 'rounded', 'circle'] as const, photo_frame => onChange({ ...design, photo_frame }), 'menu.studio.photoFrame')}
    {choices('menu.studio.decorations', design.decorations, ['minimal', 'balanced', 'expressive'] as const, decorations => onChange({ ...design, decorations }), 'menu.studio.decorations')}
    {choices('menu.studio.artPlacement', design.artwork_placement, ['header', 'sidebar', 'inset'] as const, artwork_placement => onChange({ ...design, artwork_placement }), 'menu.studio.artPlacement')}
    <View style={styles.group}><TextField label={t('menu.studio.artDirection')} placeholder={t('menu.studio.artDirectionPlaceholder')} value={design.art_direction} maxLength={600} multiline onChangeText={art_direction => onChange({ ...design, art_direction })} /></View>
    <View style={styles.toggle}><Text style={styles.label}>{t('menu.studio.showDescriptions')}</Text><Switch accessibilityLabel={t('menu.studio.showDescriptions')} value={design.show_descriptions} onValueChange={show_descriptions => onChange({ ...design, show_descriptions })} trackColor={{ true: colors.primary }} /></View>
  </View>;
}
const styles = StyleSheet.create({
  group: { marginTop: spacing.md }, label: { ...typography.footnote, color: colors.ink, marginBottom: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', borderWidth: 1, borderColor: colors.divider, borderRadius: radii.sm, backgroundColor: colors.surface },
  selected: { borderColor: colors.primary, backgroundColor: colors.subtleSurface },
  chipText: { ...typography.footnote, color: colors.ink },
  layoutOption: { flex: 1, minWidth: 80, padding: spacing.xs, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.sm },
  layoutLabel: { ...typography.caption, color: colors.ink, textAlign: 'center', marginVertical: spacing.sm },
  thumbnail: { height: 96, padding: 10, backgroundColor: colors.subtleSurface, alignItems: 'center' },
  titleLine: { width: '65%', height: 5, borderRadius: 3, marginBottom: 9 },
  miniContent: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 5, width: '100%' }, miniList: { flexDirection: 'column' },
  miniDish: { width: '27%', height: 23, borderRadius: 20 }, miniPanel: { width: '42%', height: 19, borderRadius: 5 }, miniRow: { width: '100%', height: 15, borderRadius: 3 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
});
