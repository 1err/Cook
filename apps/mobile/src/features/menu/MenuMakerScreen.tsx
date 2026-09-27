import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { UNSTABLE_usePreventRemove as usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FULL_MENU_RECIPE_LIMIT } from '@cooking/api-client';
import type { MenuRecipe } from '@cooking/shared';
import { Button, TextField } from '../../components';
import { useApiClient } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { colors, radii, spacing, typography } from '../../theme';
import type { LibraryStackParamList } from '../../navigation/types';
import { shareMenuPng, SharingUnavailableError } from './menuExport';
import { useFullMenu } from './useFullMenu';

type Props = NativeStackScreenProps<LibraryStackParamList, 'MenuMaker'>;

/** Account changes destroy this private session, including its original route selection. */
export function MenuMakerScreen(props: Props) {
  const { user } = useAuth();
  const initialAccount = useRef(user?.id);
  return <MenuSession key={user?.id ?? 'signed-out'} {...props} initialIds={initialAccount.current === user?.id ? props.route.params.recipeIds : []} />;
}

function MenuSession({ navigation, initialIds }: Props & { initialIds: string[] }) {
  const t = useT(); const api = useApiClient(); const generation = useFullMenu();
  const active = useRef(true);
  const sharingOperation = useRef<AbortController | null>(null);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [search, setSearch] = useState('');
  const [recipes, setRecipes] = useState<MenuRecipe[]>([]);
  const [selected, setSelected] = useState<string[]>(() => [...new Set(initialIds)]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const locked = generation.busy || generation.recoverable;
  const missing = selected.some(id => !recipes.some(recipe => recipe.id === id));
  const tooMany = selected.length > FULL_MENU_RECIPE_LIMIT;
  const valid = selected.length > 0 && !missing && !tooMany && !loadError;
  const visible = useMemo(() => recipes.filter(recipe => recipe.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [recipes, search]);
  const reset = generation.access?.resets_at ? new Date(generation.access.resets_at).toLocaleString() : '';

  usePreventRemove(dirty || generation.busy || generation.recoverable || !!generation.result || exporting, ({ data }) => {
    Alert.alert(t('menu.unsaved.title'), t('menu.unsaved.sessionBody'), [
      { text: t('menu.unsaved.stay'), style: 'cancel' },
      { text: t('menu.unsaved.leave'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useLayoutEffect(() => { navigation.setOptions({ title: t('menu.make'), headerBackButtonMenuEnabled: false }); }, [navigation, t]);
  useEffect(() => { active.current = true; return () => { active.current = false; sharingOperation.current?.abort(); }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setLoadError(false);
    void api.recipes.list().then(rows => { if (current) setRecipes(rows); })
      .catch(() => { if (current) setLoadError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, loadAttempt]);

  const select = (ids: string[]) => { if (!locked) { setSelected(ids); setDirty(true); } };
  const share = async () => {
    if (!generation.result || sharingOperation.current) return;
    const controller = new AbortController(); sharingOperation.current = controller;
    setExporting(true); setExportError(null);
    try { await shareMenuPng(generation.result, controller.signal); }
    catch (failure) { if (active.current && !controller.signal.aborted) setExportError(failure instanceof SharingUnavailableError ? 'menu.simple.sharingUnavailable' : 'menu.export.failed'); }
    finally { if (sharingOperation.current === controller) sharingOperation.current = null; if (active.current) setExporting(false); }
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('menu.make')}</Text>
      <Text style={styles.hint}>{t('menu.simple.intro')}</Text>
      <View style={styles.picker}>
        <TextField accessibilityLabel={t('library.searchAria')} placeholder={t('library.searchPlaceholder')} value={search} onChangeText={setSearch} leadingIcon="search" />
        <View style={styles.selectionBar}>
          <Text style={styles.count}>{t('menu.selection.count', { count: selected.length })}</Text>
          <Button title={t('menu.selection.selectAll')} variant="ghost" size="sm" disabled={locked || !recipes.length} onPress={() => select(recipes.map(recipe => recipe.id))} />
          <Button title={t('menu.selection.clear')} variant="ghost" size="sm" disabled={locked || !selected.length} onPress={() => select([])} />
        </View>
        {loadError ? <View><Text accessibilityRole="alert" style={styles.error}>{t('menu.selection.loadFailed')}</Text><Button title={t('library.retry')} variant="secondary" onPress={() => setLoadAttempt(value => value + 1)} /></View> : !recipes.length ? <Text style={styles.hint}>{t('menu.selection.empty')}</Text> :
          <ScrollView style={styles.recipeList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {visible.map(recipe => <Pressable key={recipe.id} accessibilityRole="checkbox" accessibilityLabel={t('menu.selection.selectDish', { name: recipe.title })} accessibilityState={{ checked: selected.includes(recipe.id), disabled: locked }} disabled={locked} onPress={() => select(selected.includes(recipe.id) ? selected.filter(id => id !== recipe.id) : [...selected, recipe.id])} style={styles.recipe}>
              {recipe.thumbnail_url ? <Image source={{ uri: recipe.thumbnail_url }} style={styles.thumbnail} /> : <View style={[styles.thumbnail, styles.placeholder]}><Text style={styles.placeholderText}>♨</Text></View>}
              <Text style={styles.recipeName} numberOfLines={2}>{recipe.title}</Text>
              <Text style={styles.check} accessibilityElementsHidden>{selected.includes(recipe.id) ? '☑' : '☐'}</Text>
            </Pressable>)}
          </ScrollView>}
      </View>
      {missing && <Text accessibilityRole="alert" style={styles.error}>{t('menu.selection.missingRecipes')}</Text>}
      {tooMany && <Text accessibilityRole="alert" style={styles.error}>{t('menu.simple.recipeLimit', { limit: FULL_MENU_RECIPE_LIMIT })}</Text>}
      <TextField label={t('menu.simple.title')} placeholder={t('menu.simple.titlePlaceholder')} value={title} maxLength={120} editable={!locked} onChangeText={value => { if (!locked) { setTitle(value); setDirty(true); } }} />
      <TextField label={t('menu.simple.brief')} placeholder={t('menu.simple.briefPlaceholder')} value={brief} maxLength={1200} multiline textAlignVertical="top" style={styles.brief} editable={!locked} onChangeText={value => { if (!locked) { setBrief(value); setDirty(true); } }} />
      <Text style={styles.hint}>{t(generation.checkingAccess ? 'menu.simple.quotaChecked' : generation.access?.is_admin ? 'menu.creation.adminUnlimited' : 'menu.simple.dailyAllowance')}</Text>
      {(generation.error || (!generation.checkingAccess && generation.access && !generation.access.allowed && !generation.recoverable && !generation.result)) && <Text accessibilityRole="alert" style={styles.error}>{t(generation.error ?? 'menu.creation.limitReached', { reset })}</Text>}
      {generation.error === 'menu.simple.selectionChanged' && <Button title={t('common.refresh')} variant="secondary" onPress={() => setLoadAttempt(value => value + 1)} />}
      {generation.accessErrorKey && !generation.error && !generation.recoverable && <Text accessibilityRole="alert" style={styles.error}>{t(generation.accessErrorKey)}</Text>}
      {generation.accessError && <View><Text accessibilityRole="alert" style={styles.error}>{t('menu.simple.unavailable')}</Text><Button title={t('library.retry')} variant="secondary" onPress={() => void generation.refresh()} /></View>}
      {generation.busy ? <View style={styles.actions}>
        <Button title={t(generation.checking ? 'menu.simple.checking' : 'menu.simple.generating')} onPress={() => {}} loading />
        <Button title={t('menu.simple.cancel')} variant="ghost" onPress={generation.cancel} />
      </View> : generation.recoverable ? <View style={styles.actions}>
        <Text style={styles.hint}>{t('menu.simple.waiting')}</Text>
        <Button title={t('menu.simple.check')} onPress={generation.check} />
      </View> : <Button title={t('menu.simple.generate')} disabled={!valid || !generation.allowed} loading={generation.checkingAccess} onPress={() => generation.generate({ title, brief, recipes: selected.map(id => { const recipe = recipes.find(row => row.id === id)!; return { recipe_id: id, name: recipe.title }; }) })} />}
      {generation.result && <View style={styles.result}>
        <Text style={styles.heading}>{t('menu.simple.result')}</Text>
        <Image source={{ uri: generation.result }} style={styles.menuImage} accessibilityLabel={t('menu.simple.imageAlt')} />
        <Text style={styles.hint}>{t('menu.simple.resultNote')}</Text>
        {exportError && <Text accessibilityRole="alert" style={styles.error}>{t(exportError)}</Text>}
        <Button title={t('menu.simple.share')} onPress={() => void share()} loading={exporting} />
      </View>}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  title: { ...typography.recipeTitle, color: colors.ink, marginBottom: spacing.sm }, heading: { ...typography.title3, color: colors.ink, marginBottom: spacing.md },
  hint: { ...typography.footnote, color: colors.mutedInk, lineHeight: 20, marginBottom: spacing.md }, error: { ...typography.footnote, color: colors.error, lineHeight: 20, marginBottom: spacing.md },
  picker: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.lg, padding: spacing.sm, marginBottom: spacing.lg },
  selectionBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }, count: { ...typography.caption, color: colors.mutedInk, flexGrow: 1 },
  recipeList: { maxHeight: 288 }, recipe: { flexDirection: 'row', alignItems: 'center', minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingVertical: spacing.xs, gap: spacing.sm },
  thumbnail: { width: 40, height: 40, borderRadius: radii.sm }, placeholder: { backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' }, placeholderText: { color: colors.mutedInk, fontSize: 21 },
  recipeName: { ...typography.subhead, color: colors.ink, flex: 1 }, check: { color: colors.primary, fontSize: 24, paddingHorizontal: spacing.xs },
  brief: { minHeight: 96 }, actions: { gap: spacing.sm }, result: { marginTop: spacing.xl, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.divider },
  menuImage: { width: '100%', aspectRatio: 2 / 3, resizeMode: 'contain', borderRadius: radii.md, marginBottom: spacing.md },
});
