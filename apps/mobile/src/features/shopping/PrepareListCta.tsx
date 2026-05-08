import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card } from "../../components";
import { colors, spacing, typography } from "../../theme";

type PrepareListCtaProps = {
  itemCount: number;
  refining: boolean;
  error: string | null;
  onPrepare: () => void;
};

export function PrepareListCta({ itemCount, refining, error, onPrepare }: PrepareListCtaProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Smart shopping list</Text>
      <Text style={styles.body}>
        We'll merge duplicates, infer pantry staples, and group your week's groceries by aisle.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.action}>
        <Button
          title={refining ? "Preparing…" : "Prepare smart shopping list"}
          onPress={onPrepare}
          loading={refining}
          disabled={itemCount === 0 || refining}
          fullWidth
          size="lg"
        />
        {itemCount === 0 ? (
          <Text style={styles.hint}>Plan some meals first to build a shopping list.</Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  heading: { ...typography.title3, color: colors.onSurface, marginBottom: spacing.xs },
  body: { ...typography.subhead, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  error: { ...typography.subhead, color: colors.error, marginBottom: spacing.md },
  action: { gap: spacing.sm },
  hint: { ...typography.caption, color: colors.onSurfaceVariant, textAlign: "center" },
});
