import React, { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCookingRecommendations, isCookingSessionComplete } from "@cooking/shared";
import { Button } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";
import { DishSwitcher } from "./DishSwitcher";
import { FocusedCookingStep } from "./FocusedCookingStep";
import { TimerTray } from "./TimerTray";
import type { MobileCookingSessionController } from "./useCookingSession";
import { AddDishModal } from "./AddDishModal";

export function CookWorkspace({ controller }: { controller: MobileCookingSessionController }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const session = controller.session;
  if (!session) return null;
  const focusedDish = session.dishes.find((dish) => dish.id === controller.selectedDishId) ?? session.dishes[0];
  const recommendation = getCookingRecommendations(session)[0];

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("cook.active.title")}</Text>
        {recommendation ? (
          <View style={styles.recommendation}>
            <Text style={styles.recommendationLabel}>{t("cook.recommendations.title")}</Text>
            <Text style={styles.recommendationText}>{t(recommendation.message_key, recommendation.message_params)}</Text>
          </View>
        ) : null}
        <DishSwitcher dishes={session.dishes} onSelect={controller.focusDish} selectedDishId={focusedDish?.id ?? null} />
        {controller.actionError ? <Text accessibilityRole="alert" style={styles.error}>{controller.actionError}</Text> : null}
        {focusedDish ? (
          <FocusedCookingStep
            dish={focusedDish}
            onAction={(stepId, action, extensionSeconds) => {
              if (extensionSeconds === undefined) void controller.applyAction(focusedDish.id, stepId, action);
              else void controller.applyAction(focusedDish.id, stepId, action, extensionSeconds);
            }}
          />
        ) : null}
        <View style={styles.controls}>
          <Button disabled={controller.sessionBusy} title={t("cook.control.addDish")} onPress={() => setAdding(true)} variant="secondary" />
          {focusedDish ? (
            <Button
              disabled={controller.sessionBusy}
              title={t("cook.control.removeDish", { dish: focusedDish.title })}
              onPress={() => Alert.alert(
                t("cook.control.removeDish", { dish: focusedDish.title }),
                t("cook.confirm.removeDish", { dish: focusedDish.title }),
                [
                  { text: t("common.cancel"), style: "cancel" },
                  { text: t("common.delete"), style: "destructive", onPress: () => void controller.removeDish(focusedDish.id) },
                ],
              )}
              variant="ghost"
            />
          ) : null}
          <Button disabled={controller.sessionBusy || !isCookingSessionComplete(session)} title={t("cook.control.finish")} onPress={() => void controller.finishSession()} />
          <Button
            disabled={controller.sessionBusy}
            title={t("cook.control.discard")}
            onPress={() => Alert.alert(t("cook.control.discard"), t("cook.confirm.discard"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("cook.control.discard"), style: "destructive", onPress: () => void controller.discardSession() },
            ])}
            variant="destructive"
          />
        </View>
      </ScrollView>
      <TimerTray dishes={session.dishes} />
      <AddDishModal
        existingRecipeIds={session.dishes.map((dish) => dish.recipe_id)}
        onAdd={controller.addDishes}
        onClose={() => setAdding(false)}
        visible={adding}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.lg, paddingBottom: spacing["2xl"] },
  title: { ...typography.title1, color: colors.ink, paddingHorizontal: spacing.lg },
  recommendation: { gap: spacing.xs, margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.successContainer, borderRadius: 16 },
  recommendationLabel: { ...typography.caption, color: colors.sage, fontWeight: "700" },
  recommendationText: { ...typography.headline, color: colors.ink },
  error: { ...typography.body, color: colors.error, marginHorizontal: spacing.lg },
  controls: { gap: spacing.sm, paddingHorizontal: spacing.lg },
});
