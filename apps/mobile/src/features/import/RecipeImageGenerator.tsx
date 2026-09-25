import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { ApiError, type GenerateRecipeImagePayload, type RecipeImageAccess, type RecipeImageGeneration } from "@cooking/api-client";
import { buildRecipeImageInput, createUuid, type Recipe } from "@cooking/shared";
import { Button } from "../../components";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { resolveImageUrl } from "../../lib/imageUrl";
import { colors, radii, spacing, typography } from "../../theme";

type Props = {
  recipe: Recipe;
  disabled: boolean;
  onUse: (url: string) => void;
};

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timeout = setTimeout(finish, 2_000);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(new Error("Image status check cancelled"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function errorKey(reason: string | null | undefined): string {
  if (reason === "budget_limit") return "imageGeneration.budgetLimit";
  if (reason === "storage_limit") return "imageGeneration.storageLimit";
  if (reason === "rate_limited") return "imageGeneration.rateLimited";
  if (reason === "daily_limit" || reason === "image_generation_daily_limit") return "imageGeneration.limitReached";
  if (reason === "membership_required" || reason === "image_generation_membership_required") return "imageGeneration.membershipRequired";
  if (["disabled", "unavailable", "global_limit", "image_generation_unavailable", "image_generation_disabled", "image_generation_global_limit"].includes(reason ?? "")) return "imageGeneration.unavailable";
  return "imageGeneration.failed";
}

function isDefiniteRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

export function RecipeImageGenerator({ recipe, disabled, onUse }: Props) {
  const api = useApiClient();
  const t = useT();
  const [access, setAccess] = useState<RecipeImageAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const busyRef = useRef(false);
  const candidateRef = useRef<string | null>(null);
  const originalRequest = useRef<GenerateRecipeImagePayload | null>(null);
  const operation = useRef<AbortController | null>(null);
  const accessRequest = useRef<AbortController | null>(null);

  const refreshAccess = useCallback(async () => {
    accessRequest.current?.abort();
    const controller = new AbortController();
    accessRequest.current = controller;
    if (mounted.current) setAccessLoading(true);
    try {
      const result = await api.recipes.imageGenerationAccess({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) setAccess(result);
    } catch {
      if (mounted.current && !controller.signal.aborted) setAccess(null);
    } finally {
      if (mounted.current && !controller.signal.aborted) setAccessLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refreshAccess();
    return () => {
      mounted.current = false;
      operation.current?.abort();
      accessRequest.current?.abort();
    };
  }, [refreshAccess]);

  const generate = async () => {
    if (busyRef.current || disabled || (!recoveryId && (!access?.allowed || !recipe.title.trim()))) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const requestId = recoveryId ?? createUuid();
    const payload = recoveryId && originalRequest.current
      ? originalRequest.current
      : { request_id: requestId, ...buildRecipeImageInput(recipe) };
    originalRequest.current = payload;
    const controller = new AbortController();
    operation.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let result: RecipeImageGeneration;
    let mayHaveStarted = !!recoveryId;
    const submitOriginal = async () => {
      try {
        mayHaveStarted = true;
        return await api.recipes.generateImage(payload, { signal: controller.signal });
      } catch (caught) {
        if (isDefiniteRejection(caught)) {
          mayHaveStarted = false;
          throw caught;
        }
        if (controller.signal.aborted) throw caught;
        // A lost POST response may still have generated an image. Automatic
        // recovery only checks its status; another POST requires a manual retry.
        return api.recipes.imageGenerationStatus(requestId, { signal: controller.signal });
      }
    };
    try {
      if (recoveryId) {
        try {
          result = await api.recipes.imageGenerationStatus(requestId, { signal: controller.signal });
        } catch (caught) {
          if (!(caught instanceof ApiError) || (caught.status !== 404 && caught.code !== "not_found")) throw caught;
          // The user explicitly asked to check again. An unadmitted request can
          // be safely resubmitted with its exact original payload and durable ID.
          result = await submitOriginal();
        }
      } else {
        result = await submitOriginal();
      }
      while (result.status === "pending") {
        await waitForPoll(controller.signal);
        result = await api.recipes.imageGenerationStatus(requestId, { signal: controller.signal });
      }
      if (!mounted.current || controller.signal.aborted) return;
      setRecoveryId(null);
      originalRequest.current = null;
      if (result.status === "completed" && result.file_url && resolveImageUrl(result.file_url)) {
        candidateRef.current = result.file_url;
        setCandidate(result.file_url);
      } else {
        setError(errorKey(result.error_code));
      }
    } catch (caught) {
      if (!mounted.current) return;
      setRecoveryId(mayHaveStarted ? requestId : null);
      if (!mayHaveStarted) originalRequest.current = null;
      setError(errorKey(caught instanceof ApiError ? caught.code : null));
    } finally {
      clearTimeout(timeout);
      if (operation.current === controller) operation.current = null;
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        void refreshAccess();
      }
    }
  };

  const discard = () => {
    candidateRef.current = null;
    setCandidate(null);
  };

  const useImage = () => {
    if (disabled || busyRef.current || !candidateRef.current) return;
    const url = candidateRef.current;
    discard();
    onUse(url);
  };

  const accessMessage = accessLoading
    ? t("imageGeneration.loading")
    : !access
      ? t("imageGeneration.unavailable")
      : !access.allowed
        ? t(errorKey(access.reason))
        : t("imageGeneration.remaining", { remaining: access.remaining, limit: access.daily_limit });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("imageGeneration.title")}</Text>
      <Text style={styles.description}>{t("imageGeneration.description")}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.note}>{accessMessage}</Text>
      {access?.enabled ? <Text style={styles.note}>{t("imageGeneration.attemptsNote")}</Text> : null}
      {candidate ? (
        <>
          <Image
            source={{ uri: resolveImageUrl(candidate) }}
            accessibilityLabel={t("imageGeneration.preview")}
            accessible
            style={styles.preview}
            contentFit="cover"
          />
          <Text style={styles.label}>{t("imageGeneration.aiGenerated")}</Text>
          <View style={styles.actions}>
            <Button title={t("imageGeneration.useImage")} onPress={useImage} disabled={disabled || busy} />
            <Button title={t("imageGeneration.discard")} onPress={discard} disabled={disabled || busy} variant="ghost" />
          </View>
        </>
      ) : (
        <Button
          title={t(busy ? "imageGeneration.generating" : recoveryId ? "imageGeneration.checkAgain" : "imageGeneration.generate")}
          onPress={() => void generate()}
          loading={busy}
          disabled={disabled || busy || (!recoveryId && (accessLoading || !access?.allowed || !recipe.title.trim()))}
          variant="secondary"
        />
      )}
      {!recipe.title.trim() && !candidate ? <Text style={styles.note}>{t("imageGeneration.needTitle")}</Text> : null}
      {!access && !accessLoading && !recoveryId ? (
        <Button title={t("imageGeneration.checkAgain")} onPress={() => void refreshAccess()} disabled={disabled || busy} variant="ghost" />
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface },
  title: { ...typography.headline, color: colors.ink },
  description: { ...typography.subhead, color: colors.mutedInk },
  note: { ...typography.caption, color: colors.mutedInk },
  preview: { width: "100%", aspectRatio: 3 / 2, borderRadius: radii.md },
  label: { ...typography.caption, color: colors.terracotta, fontWeight: "600" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  error: { ...typography.caption, color: colors.error },
});
