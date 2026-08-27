import React from "react";
import { View } from "react-native";
import type { RecipeTagSlug } from "@cooking/shared";
import { TextField } from "../../components";
import { OptionalImportDetails } from "./OptionalImportDetails";

type LinkInputFormProps = {
  url: string;
  onUrlChange: (next: string) => void;
  notes: string;
  onNotesChange: (next: string) => void;
  title: string;
  onTitleChange: (next: string) => void;
  libraryTags: RecipeTagSlug[];
  onTagsChange: (next: RecipeTagSlug[]) => void;
  disabled?: boolean;
};

export function LinkInputForm({
  url,
  onUrlChange,
  notes,
  onNotesChange,
  title,
  onTitleChange,
  libraryTags,
  onTagsChange,
  disabled = false,
}: LinkInputFormProps) {
  return (
    <View>
      <TextField
        label="YouTube or TikTok URL"
        placeholder="https://youtube.com/watch?v=… or https://tiktok.com/@…/video/…"
        value={url}
        onChangeText={onUrlChange}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        leadingIcon="link"
      />
      <OptionalImportDetails
        notes={notes}
        onNotesChange={onNotesChange}
        title={title}
        onTitleChange={onTitleChange}
        libraryTags={libraryTags}
        onTagsChange={onTagsChange}
        disabled={disabled}
      />
    </View>
  );
}
