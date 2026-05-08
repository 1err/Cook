import React from "react";
import { StyleSheet, View } from "react-native";
import type { IngredientItem } from "@cooking/shared";
import { Button } from "../../components";
import { spacing } from "../../theme";
import { IngredientRow } from "./IngredientRow";

type IngredientListProps = {
  value: IngredientItem[];
  onChange: (next: IngredientItem[]) => void;
};

const emptyIngredient = (): IngredientItem => ({
  name: "",
  quantity: "",
  metric_quantity: "",
  notes: "",
});

export function IngredientList({ value, onChange }: IngredientListProps) {
  return (
    <View style={styles.wrap}>
      {value.map((ingredient, index) => (
        <IngredientRow
          key={index}
          value={ingredient}
          onChange={(next) => {
            const list = [...value];
            list[index] = next;
            onChange(list);
          }}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
      <Button
        title="+ Add ingredient"
        variant="secondary"
        onPress={() => onChange([...value, emptyIngredient()])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 0, marginBottom: spacing.lg },
});
