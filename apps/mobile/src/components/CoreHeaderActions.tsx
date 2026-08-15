import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import type { RootStackParamList } from "../navigation/types";
import { colors, spacing, typography } from "../theme";
import { IconButton } from "./IconButton";

type CoreHeaderActionsProps = {
  before?: React.ReactNode;
};

export function CoreHeaderActions({ before }: CoreHeaderActionsProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const t = useT();
  const email = user?.email ?? "";
  const initial = Array.from(email)[0]?.toUpperCase() ?? "?";

  return (
    <View style={styles.actions}>
      {before}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("nav.accountFor", { email })}
        hitSlop={6}
        onPress={() => navigation.navigate("Account")}
        style={({ pressed }) => [styles.accountButton, pressed && styles.pressed]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      </Pressable>
      <IconButton
        icon="add"
        accessibilityLabel={t("nav.addRecipe")}
        onPress={() => navigation.navigate("ImportModal")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  accountButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.subtleSurface,
  },
  avatarText: {
    ...typography.subhead,
    color: colors.terracottaPressed,
    fontFamily: "Inter_600SemiBold",
  },
  pressed: {
    opacity: 0.6,
  },
});
