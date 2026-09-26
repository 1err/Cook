import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createMenuSection, moveMenuItem, updateMenuItem, type MenuDraft } from '@cooking/shared';
import { Button, TextField } from '../../components';
import { colors, radii, spacing, typography } from '../../theme';
import { useT } from '../../lib/i18n';

type Props = { draft: MenuDraft; onChange: (draft: MenuDraft) => void };
export function MenuEditor({ draft, onChange }: Props) {
  const t = useT();
  return <View>
    <Text style={styles.heading}>{t('menu.editor.title')}</Text>
    <Text style={styles.hint}>{t('menu.editor.localOnly')}</Text>
    <TextField label={t('menu.editor.menuTitle')} value={draft.title} onChangeText={title => onChange({ ...draft, title })} multiline />
    <TextField label={t('menu.editor.subtitle')} value={draft.subtitle} onChangeText={subtitle => onChange({ ...draft, subtitle })} multiline />
    {draft.sections.map((section, sectionIndex) => {
      const items = draft.items.filter(item => item.sectionId === section.id);
      return <View key={section.id} style={styles.section}>
        <TextField label={t('menu.editor.sectionHeading')} value={section.title} onChangeText={title => onChange({ ...draft, sections: draft.sections.map(row => row.id === section.id ? { ...row, title } : row) })} multiline />
        <View style={styles.row}>
          <Button title={`${t('menu.editor.moveUp')} · ${section.title}`} variant="ghost" disabled={sectionIndex === 0} onPress={() => {
            const sections = [...draft.sections]; [sections[sectionIndex - 1], sections[sectionIndex]] = [sections[sectionIndex], sections[sectionIndex - 1]]; onChange({ ...draft, sections });
          }} />
          <Button title={`${t('menu.editor.moveDown')} · ${section.title}`} variant="ghost" disabled={sectionIndex === draft.sections.length - 1} onPress={() => {
            const sections = [...draft.sections]; [sections[sectionIndex + 1], sections[sectionIndex]] = [sections[sectionIndex], sections[sectionIndex + 1]]; onChange({ ...draft, sections });
          }} />
        </View>
        {items.map((item, index) => <View key={item.recipeId} style={styles.dish}>
          <TextField label={t('menu.editor.dishName')} value={item.name} onChangeText={name => onChange(updateMenuItem(draft, item.recipeId, { name }))} multiline />
          <TextField label={t('menu.editor.description')} value={item.description} onChangeText={description => onChange(updateMenuItem(draft, item.recipeId, { description }))} multiline />
          <View style={styles.row}>
            <Button title={`${t('menu.editor.moveUp')} · ${item.name}`} variant="ghost" disabled={index === 0} onPress={() => onChange(moveMenuItem(draft, item.recipeId, section.id, index - 1))} />
            <Button title={`${t('menu.editor.moveDown')} · ${item.name}`} variant="ghost" disabled={index === items.length - 1} onPress={() => onChange(moveMenuItem(draft, item.recipeId, section.id, index + 1))} />
          </View>
          {draft.sections.length > 1 && <View>
            <Text style={styles.hint}>{t('menu.editor.moveToSection')}</Text>
            <View style={styles.row}>{draft.sections.map(target => <Pressable key={target.id} accessibilityRole="radio" accessibilityState={{ checked: target.id === section.id }} accessibilityLabel={`${t('menu.editor.moveToSection')} · ${target.title} · ${item.name}`} style={[styles.chip, target.id === section.id && styles.activeChip]} onPress={() => onChange(moveMenuItem(draft, item.recipeId, target.id, draft.items.filter(row => row.sectionId === target.id).length))}>
              <Text style={styles.chipText}>{target.title || t('menu.editor.newSection')}</Text>
            </Pressable>)}</View>
          </View>}
        </View>)}
      </View>;
    })}
    <Button title={t('menu.editor.addSection')} variant="secondary" onPress={() => onChange({ ...draft, sections: [...draft.sections, createMenuSection(t('menu.editor.newSection'))] })} />
  </View>;
}
const styles = StyleSheet.create({
  heading: { ...typography.recipeTitle, color: colors.ink, marginBottom: spacing.sm },
  hint: { ...typography.footnote, color: colors.mutedInk, marginBottom: spacing.md },
  section: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  dish: { padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.md, marginTop: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 44, justifyContent: 'center', padding: spacing.sm, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.md },
  activeChip: { backgroundColor: colors.subtleSurface, borderColor: colors.primary },
  chipText: { ...typography.footnote, color: colors.ink },
});
