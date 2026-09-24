import React from "react";
import { Linking, Text, View } from "react-native";
import { recipeSourceMomentUrl, type RecipeStep } from "@cooking/shared";
import { Button } from "../../components";
import { useT } from "../../lib/i18n";

export function StepEvidence({ step, sourceUrl }: { step: RecipeStep; sourceUrl?: string | null }) {
  const t = useT();
  const moment = step.instruction_source === "source" ? recipeSourceMomentUrl(sourceUrl, step.source_start_seconds) : null;
  if (!step.instruction_source && !moment) return null;
  return <View>
    {step.instruction_source ? <Text>{t(`recipe.tutorial.evidence.${step.instruction_source}`)}</Text> : null}
    {moment ? <Button variant="ghost" title={t("recipe.tutorial.evidence.moment")} onPress={() => { void Linking.openURL(moment).catch(() => undefined); }} /> : null}
  </View>;
}
