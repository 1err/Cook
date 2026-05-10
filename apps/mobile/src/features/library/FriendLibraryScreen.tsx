import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../../theme";

export function FriendLibraryScreen() {
  return (
    <View style={styles.center}>
      <Text style={styles.placeholder}>Friend library — coming next task</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  placeholder: { ...typography.body, color: colors.onSurfaceVariant },
});
