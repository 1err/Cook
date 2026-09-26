import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { UNSTABLE_usePreventRemove as usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { buildMenuPrintHtml, createMenuDraft, reconcileMenuSelection, type MenuDraft, type MenuFontAsset, type MenuLayout, type MenuRecipe } from '@cooking/shared';
import { Button, TextField } from '../../components';
import { useApiClient } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { colors, radii, spacing, typography } from '../../theme';
import type { LibraryStackParamList } from '../../navigation/types';
import { useMenuCreation } from './useMenuCreation';
import { MenuEditor } from './MenuEditor';
import { MenuPreview } from './MenuPreview';
import { MenuStylePicker } from './MenuStylePicker';
import { loadMenuFonts } from './menuAssets';
import { printMenu, shareMenuPdf, SharingUnavailableError } from './menuExport';
import { menuArtworkErrorKey, useMenuArtwork } from './useMenuArtwork';

type Props = NativeStackScreenProps<LibraryStackParamList, 'MenuMaker'>;

/** A new account mounts a fresh session and cannot inherit even the old route's IDs. */
export function MenuMakerScreen(props: Props) {
  const { user } = useAuth();
  const initialAccount = useRef(user?.id);
  return <MenuSession key={user?.id ?? 'signed-out'} {...props} initialIds={initialAccount.current === user?.id ? props.route.params.recipeIds : []} />;
}

function MenuSession({ navigation, initialIds }: Props & { initialIds: string[] }) {
  const t = useT(); const api = useApiClient(); const artwork = useMenuArtwork(); const creation = useMenuCreation();
  const active = useRef(true);
  const [recipes, setRecipes] = useState<MenuRecipe[]>([]);
  const [selected, setSelected] = useState<string[]>(initialIds);
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [selecting, setSelecting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<MenuFontAsset[] | null>(null);
  const [fontAttempt, setFontAttempt] = useState(0);
  const [artworkDataUrl, setArtworkDataUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  const [ready, setReady] = useState<{ layout: MenuLayout; revision: number } | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const revisionRef = useRef(revision); revisionRef.current = revision;
  const assets = useMemo(() => ({ fonts: fonts ?? [], artworkDataUrl }), [fonts, artworkDataUrl]);
  const update = (next: MenuDraft) => { setDraft(next); setRevision(value => value + 1); setReady(null); setDirty(true); setPreviewError(false); };

  usePreventRemove(dirty || exporting || artwork.busy || creation.busy, ({ data }) => {
    Alert.alert(t('menu.unsaved.title'), t('menu.unsaved.sessionBody'), [
      { text: t('menu.unsaved.stay'), style: 'cancel' },
      { text: t('menu.unsaved.leave'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useLayoutEffect(() => { navigation.setOptions({ title: t('menu.make'), headerBackButtonMenuEnabled: false }); }, [navigation, t]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void api.recipes.list().then(async rows => {
      if (!current) return;
      setRecipes(rows);
      if (initialIds.length) {
        try { const next = createMenuDraft(rows, initialIds, { title: t('menu.defaultTitle'), section: t('menu.defaultSection') }); if (await creation.ensure()) { if (!current) return; update(next); setSelecting(false); } }
        catch { setError('menu.selection.missingRecipes'); setSelecting(true); }
      }
    }).catch(() => { if (current) setError('menu.selection.loadFailed'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
    // Labels and route selection are an opening snapshot; changing language does not reset edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, loadAttempt]);
  useEffect(() => {
    let current = true; setPreviewError(false);
    void loadMenuFonts().then(value => { if (current) setFonts(value); }).catch(() => { if (current) setPreviewError(true); });
    return () => { current = false; };
  }, [fontAttempt]);
  useEffect(() => {
    if (!draft || selecting || ready?.revision === revision || previewError) return;
    const timer = setTimeout(() => setPreviewError(true), 30_000);
    return () => clearTimeout(timer);
  }, [draft, selecting, ready, revision, previewError]);

  const continueEditing = async () => {
    if (!selected.length) return;
    try {
      const next = draft ? reconcileMenuSelection(draft, recipes, selected) : createMenuDraft(recipes, selected, { title: t('menu.defaultTitle'), section: t('menu.defaultSection') });
      if (await creation.ensure()) { if (!active.current) return; update(next); setSelecting(false); setError(null); setPageIndex(0); }
    } catch { setError('menu.selection.missingRecipes'); }
  };
  const toggle = (id: string) => { setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]); setError(null); };
  const valid = !!draft && !!draft.title.trim() && draft.items.length > 0 && draft.items.every(item => !!item.name.trim());
  const canExport = valid && ready?.revision === revision && !!fonts && !previewError;
  const exportPdf = async () => {
    if (!canExport || !ready || !draft || exporting) return;
    setExporting(true); setError(null);
    try {
      const html = buildMenuPrintHtml(ready.layout, draft, assets);
      try {
        await shareMenuPdf(html, ready.layout.pages.length);
      } catch (failure) {
        if (!active.current) return;
        if (failure instanceof SharingUnavailableError) {
          Alert.alert(t('menu.export.printPdf'), t('menu.export.sharingUnavailable'), [
            { text: t('menu.unsaved.stay'), style: 'cancel' },
            { text: t('menu.export.printPdf'), onPress: () => {
              if (!active.current) return;
              setExporting(true);
              void printMenu(html)
                .catch(() => { if (active.current) setError('menu.export.failed'); })
                .finally(() => { if (active.current) setExporting(false); });
            } },
          ]);
        } else setError('menu.export.failed');
      }
    } catch { if (active.current) setError('menu.export.failed'); }
    finally { if (active.current) setExporting(false); }
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error && <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text>}
      {selecting ? <View>
        <Text style={styles.title}>{t('menu.selection.title')}</Text>
        <Text style={styles.hint}>{t('menu.selection.description')}</Text>
        <Text style={styles.hint}>{t(creation.access?.is_admin ? 'menu.creation.adminUnlimited' : 'menu.creation.dailyAllowance')}</Text>
        {creation.access && !creation.access.is_admin && creation.access.allowed && <Text style={styles.hint}>{t('menu.creation.remaining', { remaining: creation.access.remaining ?? 0, limit: creation.access.daily_limit ?? 1 })}</Text>}
        {(creation.errorKey || creation.access?.allowed === false) && !creation.admitted && <Text accessibilityRole="alert" style={styles.error}>{t(creation.errorKey ?? 'menu.creation.limitReached', { reset: creation.reset })}</Text>}
        {(creation.errorKey === 'menu.creation.unavailable' || creation.access?.allowed === false && !creation.admitted) && <Button title={t('menu.retry')} onPress={() => void creation.refresh()} />}

        {error === 'menu.selection.loadFailed' && <Button title={t('menu.retry')} onPress={() => setLoadAttempt(value => value + 1)} />}
        <View style={styles.row}>
          <Button title={t('menu.selection.selectAll')} variant="secondary" disabled={!recipes.length} onPress={() => { setSelected(recipes.map(recipe => recipe.id)); setError(null); }} />
          <Button title={t('menu.selection.clear')} variant="ghost" onPress={() => { setSelected([]); setError(null); }} />
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.hint}>{t('menu.selection.count', { count: selected.length })}</Text>
        {!recipes.length && error !== 'menu.selection.loadFailed' && <Text style={styles.hint}>{t('menu.selection.empty')}</Text>}
        {recipes.map(recipe => <Pressable key={recipe.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(recipe.id) }} accessibilityLabel={t('menu.selection.selectDish', { name: recipe.title })} onPress={() => toggle(recipe.id)} style={styles.recipe}>
          <Text style={styles.check}>{selected.includes(recipe.id) ? '☑' : '☐'}</Text><Text style={styles.recipeName}>{recipe.title}</Text>
        </Pressable>)}
        <Button title={t(creation.busy ? 'menu.creation.creating' : 'menu.selection.continue')} disabled={!selected.length || !creation.canContinue} onPress={() => void continueEditing()} />
      </View> : draft && <View>
        <Button title={t('menu.editor.back')} variant="ghost" onPress={() => { setSelected(draft.items.map(item => item.recipeId)); setSelecting(true); setReady(null); }} />
        <Text style={styles.title}>{t('menu.style.title')}</Text>
        <Text style={styles.hint}>{t('menu.style.description')}</Text>
        <MenuStylePicker value={draft.styleId} onChange={styleId => { if (styleId !== draft.styleId) update({ ...draft, styleId }); }} />
        <MenuEditor draft={draft} onChange={update} />
        <View style={styles.panel}>
          <Text style={styles.heading}>{t('menu.artwork.title')}</Text>
          <Text style={styles.hint}>{t('menu.artwork.sharedAllowance')}</Text>
          <TextField label={t('menu.style.instructions')} placeholder={t('menu.style.instructionsPlaceholder')} value={draft.instructions} maxLength={300} multiline onChangeText={instructions => update({ ...draft, instructions })} />
          <Text style={styles.hint}>{draft.instructions.length}/300</Text>
          {artwork.access && <Text style={styles.hint}>{t('menu.artwork.remaining', { remaining: artwork.access.remaining, limit: artwork.access.daily_limit })}</Text>}
          {artwork.errorKey && <Text accessibilityRole="alert" style={styles.error}>{t(artwork.errorKey)}</Text>}
          {artwork.access && !artwork.access.allowed && !artwork.errorKey && <Text style={styles.hint}>{t(menuArtworkErrorKey(artwork.access.reason, 'unavailable'))}</Text>}
          {draft.artwork && <Text style={styles.hint}>{t('menu.artwork.accepted')} · {t(`menu.style.${draft.artwork.styleId}`)}</Text>}
          {artwork.candidate && <View style={styles.candidate}>
            <Image source={{ uri: artwork.candidate.dataUrl }} style={styles.artwork} accessibilityLabel={t('menu.artwork.aiGenerated')} />
            <Text style={styles.hint}>{t('menu.artwork.candidateStyle', { style: t(`menu.style.${artwork.candidate.metadata.styleId}`) })}</Text>
            <Button title={t('menu.artwork.use')} onPress={() => {
              const candidate = artwork.candidate;
              if (!candidate) return;
              setArtworkDataUrl(candidate.dataUrl);
              update({ ...draft, styleId: candidate.metadata.styleId, artwork: candidate.metadata }); artwork.discard();
            }} />
            <Button title={t('menu.artwork.discard')} variant="ghost" onPress={artwork.discard} />
          </View>}
          {artwork.busy ? <View><Text style={styles.hint}>{t('menu.artwork.generating')}</Text><Button title={t('menu.artwork.cancel')} variant="secondary" onPress={artwork.cancel} /></View> : <View style={styles.actions}>
            <Button title={t(artwork.candidate ? 'menu.artwork.tryAnother' : 'menu.artwork.generate')} disabled={!artwork.access?.allowed} onPress={() => artwork.generate(draft.styleId, draft.instructions)} />
            {artwork.recoverable && <Button title={t('menu.artwork.checkAgain')} variant="secondary" onPress={artwork.check} />}
          </View>}
        </View>
        <View style={styles.panel}>
          <Text style={styles.heading}>{t('menu.preview.title')}</Text>
          {previewError ? <View><Text style={styles.error}>{t('menu.preview.failed')}</Text><Button title={t('menu.retry')} onPress={() => { setPreviewError(false); setReady(null); if (!fonts) setFontAttempt(value => value + 1); setPreviewAttempt(value => value + 1); }} /></View> : fonts ? <MenuPreview key={previewAttempt} draft={draft} assets={assets} revision={revision} pageIndex={pageIndex} onReady={(layout, renderedRevision) => {
            if (renderedRevision !== revisionRef.current) return;
            setReady({ layout, revision: renderedRevision }); setPageIndex(value => Math.min(value, layout.pages.length - 1));
          }} onError={() => { setReady(null); setPreviewError(true); }} /> : <ActivityIndicator color={colors.primary} />}
          {!previewError && ready?.revision !== revision && <Text style={styles.hint}>{t('menu.preview.loading')}</Text>}
          {ready?.revision === revision && <View>
            <Text accessibilityLiveRegion="polite" style={styles.pageCount}>{t('menu.preview.pageOf', { current: pageIndex + 1, total: ready.layout.pages.length })}</Text>
            <View style={styles.row}><Button title={t('menu.preview.previousPage')} variant="ghost" disabled={pageIndex === 0} onPress={() => setPageIndex(value => value - 1)} /><Button title={t('menu.preview.nextPage')} variant="ghost" disabled={pageIndex >= ready.layout.pages.length - 1} onPress={() => setPageIndex(value => value + 1)} /></View>
          </View>}
          {!valid && <Text style={styles.error}>{t('menu.editor.required')}</Text>}
          <Button title={t(exporting ? 'menu.export.exporting' : 'menu.export.pdf')} disabled={!canExport} loading={exporting} onPress={() => void exportPdf()} />
        </View>
      </View>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  title: { ...typography.recipeTitle, color: colors.ink, marginVertical: spacing.md },
  heading: { ...typography.title3, color: colors.ink, marginBottom: spacing.md },
  hint: { ...typography.footnote, color: colors.mutedInk, lineHeight: 20, marginBottom: spacing.md },
  error: { ...typography.footnote, color: colors.error, lineHeight: 20, marginBottom: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm },
  recipe: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.md, marginBottom: spacing.sm },
  check: { fontSize: 24, color: colors.primary, marginRight: spacing.md }, recipeName: { ...typography.body, flex: 1, color: colors.ink },
  panel: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.xl, marginTop: spacing.xl },
  candidate: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, marginBottom: spacing.md },
  artwork: { height: 220, width: '100%', resizeMode: 'contain', marginBottom: spacing.sm }, actions: { gap: spacing.sm },
  pageCount: { ...typography.footnote, color: colors.mutedInk, textAlign: 'center', marginTop: spacing.md },
});
