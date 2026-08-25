import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createRecipeStep,
  formatRecipeStepMetadata,
  RECIPE_ACTION_MESSAGE_KEYS,
  RECIPE_ACTION_TYPES,
  RECIPE_ATTENTION_TYPE_MESSAGE_KEYS,
  type RecipeActionType,
  type RecipeStep,
} from "@cooking/shared";
import { SegmentedControl } from "../../components";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { DurationField } from "./DurationField";

export interface StepListEditorProps {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
}

function hasValidDuration(step: RecipeStep): boolean {
  return (
    typeof step.duration_seconds === "number" &&
    Number.isInteger(step.duration_seconds) &&
    step.duration_seconds >= 1 &&
    step.duration_seconds <= 86_400
  );
}

function stepKey(step: RecipeStep, index: number): string {
  return step.id ?? `legacy-step-${index}`;
}

export function StepListEditor({
  steps,
  onChange,
  onValidityChange,
  disabled = false,
}: StepListEditorProps) {
  const t = useT();
  const [pickerStepKey, setPickerStepKey] = useState<string | null>(null);
  const [invalidStepKeys, setInvalidStepKeys] = useState<Set<string>>(() => new Set());
  const durationsValid = steps.every(
    (step, index) => hasValidDuration(step) && !invalidStepKeys.has(stepKey(step, index)),
  );
  const pickerIndex = useMemo(
    () => steps.findIndex((step, index) => stepKey(step, index) === pickerStepKey),
    [pickerStepKey, steps],
  );

  const updateAt = (index: number, patch: Partial<RecipeStep>) => {
    if (disabled || !steps[index]) return;
    const next = steps.slice();
    next[index] = { ...steps[index], ...patch };
    onChange(next);
  };

  const swap = (index: number, nextIndex: number) => {
    if (disabled || nextIndex < 0 || nextIndex >= steps.length) return;
    const next = steps.slice();
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };

  const reportDurationValidity = useCallback((key: string, valid: boolean) => {
    setInvalidStepKeys((current) => {
      const next = new Set(current);
      if (valid) next.delete(key);
      else next.add(key);
      if (next.size === current.size && [...next].every((item) => current.has(item))) return current;
      return next;
    });
  }, []);

  useEffect(() => {
    onValidityChange?.(durationsValid);
  }, [durationsValid, onValidityChange]);

  const chooseAction = (actionType: RecipeActionType) => {
    if (pickerIndex >= 0) updateAt(pickerIndex, { action_type: actionType });
    setPickerStepKey(null);
  };

  const pickerStepNumber = pickerIndex + 1;

  return (
    <View accessibilityState={{ busy: disabled }} style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>{t("recipe.steps")}</Text>
        <Pressable
          accessibilityLabel={t("recipe.step.addRow")}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => onChange([...steps, createRecipeStep()])}
          style={({ pressed }) => [
            styles.addButton,
            pressed && styles.pressed,
            disabled && styles.disabled,
          ]}
        >
          <Text style={styles.addLabel}>+ {t("recipe.step.addRow")}</Text>
        </Pressable>
      </View>

      {steps.length === 0 ? <Text style={styles.empty}>{t("recipe.steps.empty")}</Text> : null}

      {steps.map((step, index) => {
        const key = stepKey(step, index);
        const stepNumber = index + 1;
        const actionType = step.action_type ?? "other";
        return (
          <View key={key} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepIndex}>{stepNumber}</Text>
              <Text style={styles.metadata}>{formatRecipeStepMetadata(step, t)}</Text>
            </View>

            <TextInput
              accessibilityLabel={t("recipe.tutorial.editor.stepLabel", { step: stepNumber })}
              editable={!disabled}
              multiline
              placeholder={t("recipe.step.textPlaceholder")}
              style={[styles.instructions, disabled && styles.disabled]}
              value={step.text}
              onChangeText={(text) => updateAt(index, { text })}
            />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t("recipe.tutorial.editor.duration")}</Text>
              <DurationField
                disabled={disabled}
                minutesLabel={t("recipe.tutorial.editor.durationMinutes", { step: stepNumber })}
                onChange={(durationSeconds) =>
                  updateAt(index, {
                    duration_seconds: Math.max(1, Math.min(86_400, durationSeconds ?? 1)),
                    duration_source: "user",
                  })
                }
                onValidityChange={(valid) => reportDurationValidity(key, valid)}
                seconds={step.duration_seconds}
                secondsLabel={t("recipe.tutorial.editor.durationSeconds", { step: stepNumber })}
                validationMessage={t("recipe.tutorial.editor.durationInvalid")}
              />
            </View>

            <SegmentedControl
              disabled={disabled}
              label={t("recipe.tutorial.editor.attention")}
              onChange={(attentionType) => updateAt(index, { attention_type: attentionType })}
              options={[
                { value: "hands_on", label: t(RECIPE_ATTENTION_TYPE_MESSAGE_KEYS.hands_on) },
                { value: "passive", label: t(RECIPE_ATTENTION_TYPE_MESSAGE_KEYS.passive) },
              ]}
              value={step.attention_type ?? "hands_on"}
            />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t("recipe.tutorial.editor.illustration")}</Text>
              <Pressable
                accessibilityLabel={t("recipe.tutorial.editor.illustrationLabel", { step: stepNumber })}
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => setPickerStepKey(key)}
                style={({ pressed }) => [
                  styles.illustrationButton,
                  pressed && styles.pressed,
                  disabled && styles.disabled,
                ]}
              >
                <Text style={styles.illustrationLabel}>{t(RECIPE_ACTION_MESSAGE_KEYS[actionType])}</Text>
                <Text aria-hidden style={styles.disclosure}>›</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              <StepActionButton
                disabled={disabled || index === 0}
                label={t("recipe.tutorial.editor.moveUp", { step: stepNumber })}
                symbol="↑"
                onPress={() => swap(index, index - 1)}
              />
              <StepActionButton
                disabled={disabled || index === steps.length - 1}
                label={t("recipe.tutorial.editor.moveDown", { step: stepNumber })}
                symbol="↓"
                onPress={() => swap(index, index + 1)}
              />
              <StepActionButton
                destructive
                disabled={disabled}
                label={t("recipe.tutorial.editor.remove", { step: stepNumber })}
                symbol="×"
                onPress={() => onChange(steps.filter((_, itemIndex) => itemIndex !== index))}
              />
            </View>
          </View>
        );
      })}

      <Modal
        animationType="fade"
        onRequestClose={() => setPickerStepKey(null)}
        transparent
        visible={pickerIndex >= 0}
      >
        <SafeAreaView style={styles.modalBackdrop}>
          <View
            accessibilityLabel={t("recipe.tutorial.editor.illustrationOptions", {
              step: pickerStepNumber,
            })}
            accessibilityViewIsModal
            style={styles.modalSheet}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("recipe.tutorial.editor.illustration")}</Text>
              <Pressable
                accessibilityLabel={t("common.close")}
                accessibilityRole="button"
                onPress={() => setPickerStepKey(null)}
                style={styles.closeButton}
              >
                <Text style={styles.closeLabel}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.optionList}>
              {RECIPE_ACTION_TYPES.map((option) => (
                <Pressable
                  key={option}
                  accessibilityLabel={t(RECIPE_ACTION_MESSAGE_KEYS[option])}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: steps[pickerIndex]?.action_type === option }}
                  onPress={() => chooseAction(option)}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <Text style={styles.optionLabel}>{t(RECIPE_ACTION_MESSAGE_KEYS[option])}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function StepActionButton({
  destructive = false,
  disabled,
  label,
  onPress,
  symbol,
}: {
  destructive?: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
  symbol: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionLabel, destructive && styles.destructive]}>{symbol}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heading: { ...typography.title3, color: colors.ink },
  addButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  addLabel: { ...typography.subhead, color: colors.terracotta, fontWeight: "700" },
  empty: { ...typography.subhead, color: colors.mutedInk, marginTop: spacing.sm },
  stepCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.lg,
  },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepIndex: {
    ...typography.footnote,
    width: 28,
    height: 28,
    lineHeight: 28,
    textAlign: "center",
    color: colors.onAction,
    backgroundColor: colors.terracotta,
    borderRadius: radii.full,
    overflow: "hidden",
    fontWeight: "800",
  },
  metadata: { ...typography.caption, color: colors.mutedInk, flex: 1 },
  instructions: {
    ...typography.body,
    color: colors.ink,
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    textAlignVertical: "top",
  },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.subhead, color: colors.mutedInk },
  illustrationButton: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.subtleSurface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radii.md,
  },
  illustrationLabel: { ...typography.body, color: colors.ink },
  disclosure: { ...typography.title3, color: colors.mutedInk },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  actionButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.subtleSurface,
  },
  actionLabel: { ...typography.title3, color: colors.ink },
  destructive: { color: colors.error },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(38, 31, 28, 0.42)",
  },
  modalSheet: {
    maxHeight: "82%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  modalTitle: { ...typography.title3, color: colors.ink },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeLabel: { ...typography.title3, color: colors.terracotta },
  optionList: { paddingBottom: spacing.md },
  option: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  optionLabel: { ...typography.body, color: colors.ink },
});
