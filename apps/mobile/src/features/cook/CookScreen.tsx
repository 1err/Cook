import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { EmptyState } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";
import { useCookingSession } from "./useCookingSession";
import { CookSetup } from "./CookSetup";
import { CookWorkspace } from "./CookWorkspace";
import type { CookStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CookStackParamList, "CookHome">;

export function CookScreen({ navigation, route }: Partial<Props> = {}) {
  const t = useT();
  const controller = useCookingSession();
  const appliedDishId = useRef<string | null>(null);

  useEffect(() => {
    const requested = route?.params?.dishId;
    if (
      requested &&
      appliedDishId.current !== requested &&
      controller.session?.dishes.some((dish) => dish.id === requested)
    ) {
      appliedDishId.current = requested;
      controller.focusDish(requested);
    }
  }, [controller.focusDish, controller.session, route?.params?.dishId]);

  if (controller.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text>{t("common.loading")}</Text>
      </View>
    );
  }

  if (controller.status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          actionLabel={t("common.refresh")}
          description={controller.error ?? ""}
          icon="alert-circle-outline"
          onAction={() => void controller.refresh()}
          title={t("cook.error.title")}
        />
      </View>
    );
  }

  if (!controller.session) {
    return (
      <CookSetup
        onEditTutorial={(recipeId) => navigation?.getParent()?.navigate("Library", {
          screen: "RecipeEdit",
          params: { recipeId, focus: "tutorial" },
        })}
        onSessionCreated={controller.acceptSession}
      />
    );
  }

  return <CookWorkspace controller={controller} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: { ...typography.title1, color: colors.ink, textAlign: "center" },
  description: { ...typography.body, color: colors.onSurfaceVariant, textAlign: "center" },
});
