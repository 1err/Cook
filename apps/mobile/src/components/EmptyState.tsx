import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, typography } from "../theme";
import { Button } from "./Button";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type EmptyStateProps = {
  icon?: IoniconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      {icon ? (
        <View style={styles.iconBubble}>
          <Ionicons name={icon} size={32} color={colors.onPrimaryFixed} />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button title={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
    paddingHorizontal: spacing.xl,
  },
  iconBubble: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title3,
    color: colors.onSurface,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.subhead,
    color: colors.onSurfaceVariant,
    textAlign: "center",
  },
  action: { marginTop: spacing.lg },
});
