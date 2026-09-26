import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { runRecipeImport } from "@cooking/api-client";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { createManualRecipeDraft, getVisibleImportWarnings, isCompleteRecipeDraft, type Recipe, type RecipeImportCapabilities, type RecipeTagSlug } from "@cooking/shared";
import { useT } from "../../lib/i18n";
import { useApiClient } from "../../lib/api";
import { Button, EmptyState } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import type { MainTabsParamList, RootStackParamList } from "../../navigation/types";
import { ImportSourceTabs, type ImportMode } from "./ImportSourceTabs";
import { LinkInputForm } from "./LinkInputForm";
import { TranscriptInputForm } from "./TranscriptInputForm";
import { OptionalImportDetails } from "./OptionalImportDetails";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

type State = {
  phase: "input" | "draft";
  mode: ImportMode;
  url: string;
  transcript: string;
  notes: string;
  title: string;
  libraryTags: RecipeTagSlug[];
  draft: Recipe | null;
  candidate: Recipe | null;
  parsing: boolean;
  saving: boolean;
  error: string | null;
};

type Action =
  | { type: "reset"; url: string }
  | { type: "setMode"; mode: ImportMode }
  | { type: "patchInput"; patch: Partial<Pick<State, "url" | "transcript" | "notes" | "title" | "libraryTags">> }
  | { type: "previewStarted" }
  | { type: "previewStopped" }
  | { type: "previewSucceeded"; draft: Recipe }
  | { type: "previewFailed"; error: string }
  | { type: "setDraft"; draft: Recipe }
  | { type: "applyCandidate" }
  | { type: "keepDraft" }
  | { type: "resumeDraft" }
  | { type: "saveStarted" }
  | { type: "saveFailed"; error: string }
  | { type: "backToInput"; mode?: ImportMode };

const initialState: State = {
  phase: "input", mode: "link", url: "", transcript: "", notes: "", title: "", libraryTags: [],
  draft: null, candidate: null, parsing: false, saving: false, error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset": return { ...initialState, url: action.url };
    case "setMode": return { ...state, mode: action.mode, error: null };
    case "patchInput": return { ...state, ...action.patch, error: null };
    case "previewStarted": return { ...state, parsing: true, error: null };
    case "previewStopped": return { ...state, parsing: false };
    case "previewSucceeded": return { ...state, parsing: false, phase: "draft", error: null,
      ...(state.draft ? { candidate: action.draft } : { draft: action.draft }) };
    case "previewFailed": return { ...state, parsing: false, error: action.error };
    case "setDraft": return { ...state, draft: action.draft };
    case "applyCandidate": return { ...state, draft: state.candidate ?? state.draft, candidate: null };
    case "keepDraft": return { ...state, candidate: null };
    case "resumeDraft": return { ...state, phase: "draft", error: null };
    case "saveStarted": return { ...state, saving: true, error: null };
    case "saveFailed": return { ...state, saving: false, error: action.error };
    case "backToInput": return { ...state, phase: "input", mode: action.mode ?? state.mode, error: null };
  }
}

type Props = CompositeScreenProps<NativeStackScreenProps<RootStackParamList, "ImportModal">, NativeStackScreenProps<MainTabsParamList>>;
type MediaFile = { uri: string; name: string; type: string; size?: number };

export function ImportModalScreen({ navigation, route }: Props) {
  const apiClient = useApiClient();
  const currentClient = useRef(apiClient);
  currentClient.current = apiClient;
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  const initialUrl = useRef(route.params?.initialUrl?.trim() ?? "");
  const t = useT();
  const [manual, setManual] = useState(false);
  const [capabilities, setCapabilities] = useState<RecipeImportCapabilities | null>(null);
  const [media, setMedia] = useState<MediaFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [state, dispatch] = useReducer(reducer, { ...initialState, url: initialUrl.current });

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    active.current?.abort(); active.current = null;
    dispatch({ type: "reset", url: initialUrl.current });
    setManual(false); setMedia(null); setPicking(false); setCapabilities(null);
    void apiClient.recipes.importCapabilities().then(result => { if (alive) setCapabilities(result); }).catch(() => undefined);
    return () => { alive = false; mounted.current = false; active.current?.abort(); active.current = null; };
  }, [apiClient]);

  const cancelImport = useCallback(() => {
    active.current?.abort(); active.current = null;
    dispatch({ type: "previewStopped" });
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({ headerLeft: () => <Button title="Cancel" variant="ghost" onPress={() => { cancelImport(); navigation.goBack(); }} /> });
  }, [navigation, cancelImport]);

  const handlePreview = useCallback(async (analyzeVideo = false) => {
    if (active.current || picking || state.saving) return;
    const sourceUrl = state.draft?.source_url || state.url.trim();
    if ((analyzeVideo || state.mode === "link") && !sourceUrl) {
      dispatch({ type: "previewFailed", error: "Paste a YouTube or TikTok URL first." }); return;
    }
    if (!analyzeVideo && state.mode === "transcript" && !state.transcript.trim()) {
      dispatch({ type: "previewFailed", error: "Paste a transcript first." }); return;
    }
    if ((analyzeVideo && !capabilities?.video_analysis) || (!analyzeVideo && state.mode === "media" && (!media || !capabilities?.media_upload))) return;
    if (!analyzeVideo && state.mode === "media" && media?.size != null && media.size > capabilities!.max_media_bytes) {
      dispatch({ type: "previewFailed", error: t("import.mediaTooLarge") }); return;
    }
    const controller = new AbortController();
    active.current = controller;
    dispatch({ type: "previewStarted" });
    try {
      const payload = {
        url: sourceUrl || undefined,
        notes: state.notes.trim() || undefined,
        title: state.title.trim() || state.draft?.title || undefined,
        library_tags: state.libraryTags.length ? state.libraryTags : state.draft?.library_tags,
      };
      const start = () => {
        if (!analyzeVideo && state.mode === "media" && media) {
          const form = new FormData();
          // React Native accepts this local file descriptor and streams the file.
          form.append("file", { uri: media.uri, name: media.name, type: media.type } as unknown as Blob);
          if (payload.url) form.append("source_url", payload.url);
          if (payload.notes) form.append("notes", payload.notes);
          if (payload.title) form.append("title", payload.title);
          if (payload.library_tags) form.append("library_tags", JSON.stringify(payload.library_tags));
          return apiClient.recipes.createMediaImportJob(form);
        }
        return apiClient.recipes.createImportJob({ ...payload, mode: analyzeVideo ? "video" : state.mode === "transcript" ? "text" : "link",
          transcript: !analyzeVideo && state.mode === "transcript" ? state.transcript.trim() : undefined });
      };
      const draft = await runRecipeImport(start, apiClient.recipes, controller.signal);
      if (!mounted.current || active.current !== controller || controller.signal.aborted || currentClient.current !== apiClient) return;
      if (!state.draft) setManual(false);
      dispatch({ type: "previewSucceeded", draft: { ...draft, source_url: draft.source_url || sourceUrl || null } });
    } catch (error) {
      if (!mounted.current || active.current !== controller || controller.signal.aborted || currentClient.current !== apiClient) return;
      dispatch({ type: "previewFailed", error: error instanceof Error ? error.message : t("import.failed") });
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) dispatch({ type: "previewStopped" }); }
    }
  }, [apiClient, state, picking, capabilities, media, t]);

  const pickVideo = useCallback(async () => {
    if (picking || state.parsing || !capabilities?.media_upload) return;
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error(t("import.mediaPermission"));
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: false });
      if (!mounted.current || currentClient.current !== apiClient || result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize != null && asset.fileSize > capabilities.max_media_bytes) throw new Error(t("import.mediaTooLarge"));
      const name = asset.fileName || asset.uri.split("/").pop() || "video.mp4";
      const mime = asset.mimeType || (name.toLowerCase().endsWith(".mov") ? "video/quicktime" : name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4");
      if (!["video/mp4", "video/quicktime", "video/mov", "video/webm"].includes(mime)) throw new Error(t("import.mediaUnsupported"));
      setMedia({ uri: asset.uri, name, type: mime, size: asset.fileSize });
      dispatch({ type: "patchInput", patch: {} });
    } catch (error) {
      if (mounted.current && currentClient.current === apiClient) dispatch({ type: "previewFailed", error: error instanceof Error ? error.message : t("import.failed") });
    } finally {
      if (mounted.current && currentClient.current === apiClient) setPicking(false);
    }
  }, [apiClient, capabilities, picking, state.parsing, t]);

  const handleSave = useCallback(async () => {
    if (!state.draft || state.saving || state.parsing || (manual && !isCompleteRecipeDraft(state.draft))) return;
    dispatch({ type: "saveStarted" });
    try {
      // Older import jobs may still include the retired equipment field.
      const { equipment: _equipment, ...recipeDraft } = state.draft;
      const saved = await apiClient.recipes.create({ ...recipeDraft,
        ingredients: state.draft.ingredients.filter(ingredient => ingredient.name.trim()),
        ...(manual ? { title: state.draft.title.trim(), steps: state.draft.steps?.filter(step => step.text.trim()) } : {}),
      });
      if (!mounted.current || currentClient.current !== apiClient) return;
      navigation.goBack();
      navigation.getParent()?.navigate("Main", { screen: "Library", params: { screen: "RecipeDetail", params: { recipeId: saved.id } } });
    } catch (error) {
      if (!mounted.current || currentClient.current !== apiClient) return;
      dispatch({ type: "saveFailed", error: error instanceof Error ? error.message : "Couldn't save your recipe." });
    }
  }, [apiClient, navigation, state.draft, state.saving, state.parsing, manual]);

  const busy = state.parsing || picking || state.saving;
  const progress = state.parsing ? <View style={styles.notice} accessibilityLiveRegion="polite">
    <Text style={styles.body}>{t("import.processing")}</Text>
    <Button title={t("import.cancelJob")} variant="ghost" onPress={cancelImport} />
  </View> : null;

  if (state.phase === "draft" && state.draft) {
    return <DraftRecipeEditor draft={state.draft} requireCompleteRecipe={manual} disabled={state.parsing}
      onChange={draft => dispatch({ type: "setDraft", draft })} saving={state.saving} error={state.error}
      onSave={handleSave} onCancel={() => dispatch({ type: "backToInput" })}
      saveLabel="Save recipe" cancelLabel="Back to import" allowImageEditing={false}
      reviewHeader={<>
        {progress}
        {state.candidate ? <View style={styles.notice}>
          <Text style={styles.body}>{t("import.reviewCandidate")}</Text>
          <Text style={styles.heading}>{state.candidate.title}</Text>
          {state.candidate.ingredients.map((ingredient, index) => <Text key={`ingredient-${index}`} style={styles.body}>{ingredient.quantity} {ingredient.name}</Text>)}
          {state.candidate.steps?.map((step, index) => <Text key={step.id || index} style={styles.body}>{index + 1}. {step.text}</Text>)}
          <Button title={t("import.applyCandidate")} disabled={busy} onPress={() => { setManual(false); dispatch({ type: "applyCandidate" }); }} />
          <Button title={t("import.keepDraft")} variant="ghost" disabled={busy} onPress={() => dispatch({ type: "keepDraft" })} />
        </View> : null}
        {state.draft.import_review?.status === "needs_review" ? <View style={styles.notice}>
          <Text style={styles.heading}>{t("import.partialTitle")}</Text>
          <Text style={styles.body}>{t("import.partialHelp")}</Text>
          {getVisibleImportWarnings(state.draft.import_review.warnings).map(warning => <Text key={warning} style={styles.body}>{warning}</Text>)}
          {capabilities?.video_analysis && state.draft.import_review.can_analyze_video ?
            <Button title={t("import.analyzeVideo")} variant="secondary" disabled={busy} onPress={() => void handlePreview(true)} /> :
            <Text style={styles.body}>{t("import.videoUnavailable")}</Text>}
          <Button title={t("import.recoveryText")} variant="ghost" disabled={busy} onPress={() => dispatch({ type: "backToInput", mode: "transcript" })} />
          {capabilities?.media_upload ? <Button title={t("import.pickVideo")} variant="ghost" disabled={busy} onPress={() => dispatch({ type: "backToInput", mode: "media" })} /> : null}
        </View> : null}
      </>} />;
  }

  const details = { notes: state.notes, onNotesChange: (notes: string) => dispatch({ type: "patchInput", patch: { notes } }),
    title: state.title, onTitleChange: (title: string) => dispatch({ type: "patchInput", patch: { title } }),
    libraryTags: state.libraryTags, onTagsChange: (libraryTags: RecipeTagSlug[]) => dispatch({ type: "patchInput", patch: { libraryTags } }), disabled: busy };
  return <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {progress}
    {state.draft ? <Button title={t("import.resumeDraft")} variant="secondary" disabled={busy} onPress={() => dispatch({ type: "resumeDraft" })} /> :
      <Button title={t("import.createManually")} variant="secondary" disabled={busy} onPress={() => { setManual(true); dispatch({ type: "previewSucceeded", draft: createManualRecipeDraft() }); }} />}
    <ImportSourceTabs value={state.mode} onChange={mode => dispatch({ type: "setMode", mode })} disabled={busy} />
    {state.mode === "link" ? <LinkInputForm {...details} url={state.url} onUrlChange={url => dispatch({ type: "patchInput", patch: { url } })} /> :
      state.mode === "transcript" ? <TranscriptInputForm {...details} transcript={state.transcript} onTranscriptChange={transcript => dispatch({ type: "patchInput", patch: { transcript } })} /> :
      <View style={styles.media}>
        <Text style={styles.body}>{t("import.mediaHint")}</Text>
        {capabilities?.media_upload ? <>
          <Text style={styles.body}>{t("import.mediaLimit", { size: Math.floor(capabilities.max_media_bytes / (1024 * 1024)) })}</Text>
          <Button title={t("import.pickVideo")} variant="secondary" loading={picking} disabled={busy} onPress={() => void pickVideo()} />
          {media ? <Text style={styles.body}>{t("import.mediaSelected", { name: media.name })}</Text> : null}
        </> : <Text style={styles.body}>{t("import.videoUnavailable")}</Text>}
        <OptionalImportDetails {...details} />
      </View>}
    {(state.draft?.source_url || state.url.trim()) && state.mode !== "link" ? <Text style={styles.body}>{t("import.sourcePreserved")}</Text> : null}
    {state.error ? <View style={styles.errorWrap}><EmptyState icon="alert-circle-outline" title="Couldn't parse" description={state.error} /></View> : null}
    <View style={styles.actions}><Button title={state.parsing ? t("import.processing") : "Preview recipe"} onPress={() => void handlePreview()}
      loading={state.parsing} disabled={busy || (state.mode === "media" && (!media || !capabilities?.media_upload))} fullWidth size="lg" /></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing["3xl"] },
  errorWrap: { marginTop: spacing.md },
  actions: { marginTop: spacing.xl },
  media: { gap: spacing.md },
  notice: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg, gap: spacing.sm },
  heading: { ...typography.headline, color: colors.ink },
  body: { ...typography.subhead, color: colors.ink },
});
