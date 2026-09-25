"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, type GenerateRecipeImagePayload, type RecipeImageAccess, type RecipeImageGeneration } from "@cooking/api-client";
import { buildRecipeImageInput, createUuid, type Recipe } from "@cooking/shared";
import { webApiClient } from "../lib/api";
import { useT } from "../lib/i18n";
import styles from "./RecipeImageGenerator.module.css";

type Props = {
  recipe: Pick<Recipe, "title" | "description" | "ingredients" | "steps">;
  onAccept: (url: string) => void;
  disabled?: boolean;
  headingLevel?: 2 | 3;
};

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 2000);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function errorMessageKey(code: string | null | undefined): string {
  if (code === "membership_required") return "imageGeneration.membershipRequired";
  if (code === "daily_limit") return "imageGeneration.limitReached";
  if (code === "rate_limited") return "imageGeneration.rateLimited";
  if (code === "budget_limit") return "imageGeneration.budgetLimit";
  if (code === "storage_limit") return "imageGeneration.storageLimit";
  if (["global_limit", "disabled", "unavailable"].includes(code ?? "")) return "imageGeneration.unavailable";
  return "imageGeneration.failed";
}

export function RecipeImageGenerator({ recipe, onAccept, disabled = false, headingLevel = 2 }: Props) {
  const t = useT();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = useId();
  const [access, setAccess] = useState<RecipeImageAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [unresolvedId, setUnresolvedId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const accessController = useRef<AbortController | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const originalAttempt = useRef<GenerateRecipeImagePayload | null>(null);

  const refreshAccess = useCallback(async () => {
    accessController.current?.abort();
    const controller = new AbortController();
    accessController.current = controller;
    setLoading(true);
    try {
      const next = await webApiClient.recipes.imageGenerationAccess({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted) setAccess(next);
    } catch {
      if (mounted.current && !controller.signal.aborted) setAccess(null);
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshAccess();
    return () => {
      mounted.current = false;
      accessController.current?.abort();
      generationController.current?.abort();
    };
  }, [refreshAccess]);

  async function generate(recoverId?: string) {
    if (locked.current || disabled) return;
    if (!recoverId && (!access?.allowed || !recipe.title.trim())) return;
    locked.current = true;
    setGenerating(true);
    setErrorKey(null);
    const requestId = recoverId ?? createUuid();
    if (!recoverId) originalAttempt.current = { request_id: requestId, ...buildRecipeImageInput(recipe) };
    setUnresolvedId(requestId);
    const controller = new AbortController();
    generationController.current = controller;
    const deadline = setTimeout(() => controller.abort(), 90_000);
    const options = { signal: controller.signal };
    async function submitAttempt(payload: GenerateRecipeImagePayload): Promise<RecipeImageGeneration> {
      try {
        return await webApiClient.recipes.generateImage(payload, options);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // A rejected request is definitive; a lost response may still have
        // generated an image. Automatic recovery only checks that attempt.
        if (error instanceof ApiError && (error.status < 500 || error.code === "disabled")) {
          setUnresolvedId(null);
          throw error;
        }
        return await webApiClient.recipes.imageGenerationStatus(requestId, options);
      }
    }
    try {
      let result: RecipeImageGeneration;
      if (recoverId) {
        try {
          result = await webApiClient.recipes.imageGenerationStatus(requestId, options);
        } catch (error) {
          const missing = error instanceof ApiError && (error.status === 404 || error.code === "not_found");
          const original = originalAttempt.current;
          if (controller.signal.aborted || !missing || original?.request_id !== requestId) throw error;
          // Only an explicit Check again may replay a missing attempt. Keep the
          // original payload and ID so server idempotency protects the charge.
          result = await submitAttempt(original);
        }
      } else {
        result = await submitAttempt(originalAttempt.current!);
      }
      while (result.status === "pending" && !controller.signal.aborted) {
        result = await webApiClient.recipes.imageGenerationStatus(requestId, options);
        if (result.status === "pending") await pause(controller.signal);
      }
      if (!mounted.current || controller.signal.aborted) return;
      setUnresolvedId(null);
      if (result.status === "completed" && result.file_url) {
        setCandidate(result.file_url);
      } else {
        setErrorKey(errorMessageKey(result.error_code));
      }
    } catch (error) {
      if (!mounted.current) return;
      setErrorKey(errorMessageKey(error instanceof ApiError ? error.code : null));
    } finally {
      clearTimeout(deadline);
      if (generationController.current === controller) generationController.current = null;
      locked.current = false;
      if (mounted.current) {
        setGenerating(false);
        void refreshAccess();
      }
    }
  }

  const accessMessage = loading ? null : !access
    ? "imageGeneration.unavailable"
    : access.reason === "membership_required"
      ? "imageGeneration.membershipRequired"
      : access.reason === "daily_limit"
        ? "imageGeneration.limitReached"
        : !access.allowed ? "imageGeneration.unavailable" : null;

  return (
    <section className={styles.panel} aria-labelledby={headingId} aria-busy={generating || undefined}>
      <Heading id={headingId} className={styles.title}>{t("imageGeneration.title")}</Heading>
      <p className={styles.description}>{t("imageGeneration.description")}</p>

      {candidate ? (
        <figure className={styles.candidate}>
          <img src={candidate} alt={t("imageGeneration.preview")} />
          <figcaption>{t("imageGeneration.aiGenerated")}</figcaption>
        </figure>
      ) : null}

      <div className={styles.actions}>
        {candidate ? (
          <>
            <button type="button" className={styles.primary} disabled={disabled || generating} onClick={() => {
              if (disabled || generating) return;
              onAccept(candidate);
              setCandidate(null);
            }}>{t("imageGeneration.useImage")}</button>
            <button type="button" className={styles.secondary} disabled={disabled || generating} onClick={() => setCandidate(null)}>
              {t("imageGeneration.discard")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.secondary}
            disabled={disabled || generating || (!unresolvedId && (loading || !access?.allowed || !recipe.title.trim()))}
            onClick={() => void generate(unresolvedId ?? undefined)}
          >
            {t(generating ? "imageGeneration.generating" : unresolvedId ? "imageGeneration.checkAgain" : "imageGeneration.generate")}
          </button>
        )}
        {!loading && !access && !unresolvedId ? (
          <button type="button" className={styles.textButton} disabled={disabled || generating} onClick={() => void refreshAccess()}>
            {t("imageGeneration.checkAgain")}
          </button>
        ) : null}
      </div>

      <div className={styles.details} aria-live="polite">
        {loading ? <p>{t("imageGeneration.loading")}</p> : accessMessage ? <p>{t(accessMessage)}</p> : null}
        {!loading && access?.enabled ? <p>{t("imageGeneration.remaining", { remaining: access.remaining, limit: access.daily_limit })}</p> : null}
        {!recipe.title.trim() && access?.allowed ? <p>{t("imageGeneration.needTitle")}</p> : null}
        {access?.allowed ? <p>{t("imageGeneration.attemptsNote")}</p> : null}
      </div>
      {errorKey ? <p className={styles.error} role="alert">{t(errorKey)}</p> : null}
    </section>
  );
}
