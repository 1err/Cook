import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, typography } from "../../theme";
import { resolveImageUrl } from "../../lib/imageUrl";

type ImagePickerButtonProps = {
  thumbnailUrl: string | null;
  isUploading: boolean;
  error: string | null;
  onPick: () => void;
  onClear?: () => void;
};

export function ImagePickerButton({
  thumbnailUrl,
  isUploading,
  error,
  onPick,
  onClear,
}: ImagePickerButtonProps) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPick}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel={thumbnailUrl ? "Replace cover image" : "Add cover image"}
        style={({ pressed }) => [styles.frame, pressed && styles.pressed]}
      >
        {resolveImageUrl(thumbnailUrl) ? (
          <Image source={{ uri: resolveImageUrl(thumbnailUrl) }} style={styles.image} contentFit="cover" transition={150} />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="image-outline" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.placeholderText}>Tap to add a cover image</Text>
          </View>
        )}
        {isUploading ? (
          <View style={styles.overlay}>
            <ActivityIndicator color={colors.onPrimary} />
          </View>
        ) : null}
      </Pressable>
      <View style={styles.actionsRow}>
        {thumbnailUrl ? (
          <Pressable onPress={onPick} disabled={isUploading}>
            <Text style={styles.actionText}>Replace</Text>
          </Pressable>
        ) : null}
        {thumbnailUrl && onClear ? (
          <Pressable onPress={onClear} disabled={isUploading}>
            <Text style={[styles.actionText, styles.removeText]}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  frame: {
    aspectRatio: 16 / 9,
    width: "100%",
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  image: { width: "100%", height: "100%" },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  placeholderText: { ...typography.subhead, color: colors.onSurfaceVariant },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(26, 28, 28, 0.45)",
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
  actionText: { ...typography.subhead, color: colors.primary, fontWeight: "600" },
  removeText: { color: colors.error },
  error: { ...typography.caption, color: colors.error, marginTop: spacing.xs },
  pressed: { opacity: 0.92 },
});
