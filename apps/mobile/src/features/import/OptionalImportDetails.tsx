import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RecipeTagSlug } from "@cooking/shared";
import { TextField } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import { TagPicker } from "./TagPicker";

type OptionalImportDetailsProps = {
  notes: string;
  onNotesChange: (next: string) => void;
  title: string;
  onTitleChange: (next: string) => void;
  libraryTags: RecipeTagSlug[];
  onTagsChange: (next: RecipeTagSlug[]) => void;
};

export function OptionalImportDetails({
  notes,
  onNotesChange,
  title,
  onTitleChange,
  libraryTags,
  onTagsChange,
}: OptionalImportDetailsProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Optional details"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View>
          <Text style={styles.title}>Optional details</Text>
          <Text style={styles.summary}>Title, parsing notes, and tags</Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedInk}
        />
      </Pressable>
      {open ? (
        <View style={styles.fields}>
          <TextField
            label="Title (optional)"
            placeholder="Override the auto-generated title"
            value={title}
            onChangeText={onTitleChange}
            autoCapitalize="words"
          />
          <TextField
            label="Notes (optional)"
            placeholder="Anything the parser should know?"
            value={notes}
            onChangeText={onNotesChange}
            multiline
            numberOfLines={4}
            style={styles.multiline}
          />
          <Text style={styles.sectionLabel}>Tags (optional)</Text>
          <TagPicker value={libraryTags} onChange={onTagsChange} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  trigger: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.md,
  },
  title: { ...typography.headline, color: colors.ink },
  summary: { ...typography.caption, color: colors.mutedInk, marginTop: 2 },
  fields: { marginTop: spacing.md },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  sectionLabel: { ...typography.headline, color: colors.ink, marginBottom: spacing.sm },
  pressed: { opacity: 0.82 },
});
