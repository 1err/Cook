import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { IngredientItem } from "@cooking/shared";
import { TextField } from "../../components";
import { colors, radii, spacing } from "../../theme";

type IngredientRowProps = {
  value: IngredientItem;
  onChange: (next: IngredientItem) => void;
  onRemove: () => void;
};

export function IngredientRow({ value, onChange, onRemove }: IngredientRowProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.nameField}>
          <TextField
            label="Ingredient"
            placeholder="e.g. Chicken thigh"
            value={value.name}
            onChangeText={(name) => onChange({ ...value, name })}
            autoCapitalize="sentences"
          />
        </View>
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel="Remove ingredient"
          hitSlop={10}
          style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </Pressable>
      </View>
      <View style={styles.qtyRow}>
        <View style={styles.qtyField}>
          <TextField
            label="Quantity"
            placeholder="e.g. 2 cups"
            value={value.quantity}
            onChangeText={(quantity) => onChange({ ...value, quantity })}
          />
        </View>
        <View style={styles.qtyField}>
          <TextField
            label="Metric"
            placeholder="e.g. 500g"
            value={value.metric_quantity ?? ""}
            onChangeText={(metric_quantity) => onChange({ ...value, metric_quantity })}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  nameField: { flex: 1 },
  removeBtn: {
    padding: spacing.sm,
    marginTop: 18,
  },
  qtyRow: { flexDirection: "row", gap: spacing.sm },
  qtyField: { flex: 1 },
  pressed: { opacity: 0.6 },
});
