import React, { useCallback, useLayoutEffect, useReducer } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Recipe, RecipeTagSlug } from "@cooking/shared";
import { useApiClient } from "../../lib/api";
import { Button, EmptyState } from "../../components";
import { colors, spacing } from "../../theme";
import type { MainTabsParamList, RootStackParamList } from "../../navigation/types";
import { ImportSourceTabs, type ImportMode } from "./ImportSourceTabs";
import { LinkInputForm } from "./LinkInputForm";
import { TranscriptInputForm } from "./TranscriptInputForm";
import { DraftRecipeEditor } from "./DraftRecipeEditor";

type Phase = "input" | "draft";

type State = {
  phase: Phase;
  mode: ImportMode;
  url: string;
  transcript: string;
  notes: string;
  title: string;
  libraryTags: RecipeTagSlug[];
  draft: Recipe | null;
  parsing: boolean;
  saving: boolean;
  error: string | null;
};

type Action =
  | { type: "setMode"; mode: ImportMode }
  | { type: "patchInput"; patch: Partial<Pick<State, "url" | "transcript" | "notes" | "title" | "libraryTags">> }
  | { type: "previewStarted" }
  | { type: "previewSucceeded"; draft: Recipe }
  | { type: "previewFailed"; error: string }
  | { type: "setDraft"; draft: Recipe }
  | { type: "saveStarted" }
  | { type: "saveFailed"; error: string }
  | { type: "backToInput" };

const initialState: State = {
  phase: "input",
  mode: "link",
  url: "",
  transcript: "",
  notes: "",
  title: "",
  libraryTags: [],
  draft: null,
  parsing: false,
  saving: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setMode":
      return { ...state, mode: action.mode, error: null };
    case "patchInput":
      return { ...state, ...action.patch, error: null };
    case "previewStarted":
      return { ...state, parsing: true, error: null };
    case "previewSucceeded":
      return { ...state, parsing: false, phase: "draft", draft: action.draft, error: null };
    case "previewFailed":
      return { ...state, parsing: false, error: action.error };
    case "setDraft":
      return { ...state, draft: action.draft };
    case "saveStarted":
      return { ...state, saving: true, error: null };
    case "saveFailed":
      return { ...state, saving: false, error: action.error };
    case "backToInput":
      return { ...state, phase: "input", draft: null, error: null };
  }
}

type Props = CompositeScreenProps<
  NativeStackScreenProps<RootStackParamList, "ImportModal">,
  NativeStackScreenProps<MainTabsParamList>
>;

export function ImportModalScreen({ navigation }: Props) {
  const apiClient = useApiClient();
  const [state, dispatch] = useReducer(reducer, initialState);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
      ),
    });
  }, [navigation]);

  const handlePreview = useCallback(async () => {
    if (state.mode === "link" && !state.url.trim()) {
      dispatch({ type: "previewFailed", error: "Paste a YouTube URL first." });
      return;
    }
    if (state.mode === "transcript" && !state.transcript.trim()) {
      dispatch({ type: "previewFailed", error: "Paste a transcript first." });
      return;
    }
    dispatch({ type: "previewStarted" });
    try {
      const payload = {
        notes: state.notes.trim() || undefined,
        title: state.title.trim() || undefined,
        library_tags: state.libraryTags.length > 0 ? state.libraryTags : undefined,
      };
      const draft =
        state.mode === "link"
          ? await apiClient.recipes.parseLink({ url: state.url.trim(), ...payload })
          : await apiClient.recipes.parseTranscript({
              transcript: state.transcript.trim(),
              ...payload,
            });
      dispatch({ type: "previewSucceeded", draft });
    } catch (e) {
      dispatch({
        type: "previewFailed",
        error: e instanceof Error ? e.message : "Couldn't parse your recipe.",
      });
    }
  }, [apiClient, state.mode, state.url, state.transcript, state.notes, state.title, state.libraryTags]);

  const handleSave = useCallback(async () => {
    if (!state.draft) return;
    dispatch({ type: "saveStarted" });
    try {
      const cleanedIngredients = state.draft.ingredients.filter((i) => i.name.trim().length > 0);
      const saved = await apiClient.recipes.create({
        ...state.draft,
        ingredients: cleanedIngredients,
      });
      navigation.goBack();
      navigation.getParent()?.navigate("Main", {
        screen: "Library",
        params: { screen: "RecipeDetail", params: { recipeId: saved.id } },
      });
    } catch (e) {
      dispatch({
        type: "saveFailed",
        error: e instanceof Error ? e.message : "Couldn't save your recipe.",
      });
    }
  }, [apiClient, navigation, state.draft]);

  if (state.phase === "draft" && state.draft) {
    return (
      <DraftRecipeEditor
        draft={state.draft}
        onChange={(next) => dispatch({ type: "setDraft", draft: next })}
        saving={state.saving}
        error={state.error}
        onSave={handleSave}
        onCancel={() => dispatch({ type: "backToInput" })}
        saveLabel="Save recipe"
        cancelLabel="Back to import"
        allowImageEditing={false}
      />
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <ImportSourceTabs value={state.mode} onChange={(mode) => dispatch({ type: "setMode", mode })} />
      {state.mode === "link" ? (
        <LinkInputForm
          url={state.url}
          onUrlChange={(url) => dispatch({ type: "patchInput", patch: { url } })}
          notes={state.notes}
          onNotesChange={(notes) => dispatch({ type: "patchInput", patch: { notes } })}
          title={state.title}
          onTitleChange={(title) => dispatch({ type: "patchInput", patch: { title } })}
          libraryTags={state.libraryTags}
          onTagsChange={(libraryTags) => dispatch({ type: "patchInput", patch: { libraryTags } })}
        />
      ) : (
        <TranscriptInputForm
          transcript={state.transcript}
          onTranscriptChange={(transcript) => dispatch({ type: "patchInput", patch: { transcript } })}
          notes={state.notes}
          onNotesChange={(notes) => dispatch({ type: "patchInput", patch: { notes } })}
          title={state.title}
          onTitleChange={(title) => dispatch({ type: "patchInput", patch: { title } })}
          libraryTags={state.libraryTags}
          onTagsChange={(libraryTags) => dispatch({ type: "patchInput", patch: { libraryTags } })}
        />
      )}

      {state.error ? (
        <View style={styles.errorWrap}>
          <EmptyState icon="alert-circle-outline" title="Couldn't parse" description={state.error} />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          title={state.parsing ? "Parsing…" : "Preview recipe"}
          onPress={handlePreview}
          loading={state.parsing}
          disabled={state.parsing}
          fullWidth
          size="lg"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  errorWrap: { marginTop: spacing.md },
  actions: { marginTop: spacing.lg },
});
