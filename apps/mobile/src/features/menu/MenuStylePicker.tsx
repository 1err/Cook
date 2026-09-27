import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MENU_STYLES, type MenuStyleId } from '@cooking/shared';
import { colors, radii, spacing, typography } from '../../theme';
import { useT } from '../../lib/i18n';

type Props = { value: MenuStyleId; onChange: (value: MenuStyleId) => void };
export function MenuStylePicker({ value, onChange }: Props) {
  const t = useT();
  return <View style={styles.grid}>
    {MENU_STYLES.map(preset => <Pressable key={preset.id} accessibilityRole="radio" accessibilityLabel={t(preset.labelKey)}
      accessibilityState={{ checked: value === preset.id }} onPress={() => onChange(preset.id)}
      style={[styles.option, value === preset.id && styles.selected]}>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.swatch, { backgroundColor: preset.colors.background }]}>
        {[preset.colors.background, preset.colors.panel, preset.colors.accent, preset.colors.text].map((color, index) => <View key={index} style={[styles.colorDot, { backgroundColor: color }]} />)}
      </View>
      <Text style={[styles.label, value === preset.id && { color: colors.primary }]}>{t(preset.labelKey)}</Text>
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.md },
  option: { width: '47%', flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surface, padding: 6 },
  selected: { borderColor: colors.primary, borderWidth: 2, padding: 5 },
  swatch: { height: 50, flexDirection: 'row', gap: 5, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  colorDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.divider },
  label: { ...typography.footnote, color: colors.ink, textAlign: 'center', marginVertical: spacing.sm },
});
