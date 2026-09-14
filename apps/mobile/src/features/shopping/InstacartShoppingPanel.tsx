import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text } from "react-native";
import { ApiError } from "@cooking/api-client";
import { isSafeInstacartUrl, type InstacartItem } from "@cooking/shared";
import { Card } from "../../components";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { colors, spacing, typography } from "../../theme";

type Props = {
  items: InstacartItem[];
  listKey: string;
  disabled?: boolean;
};

export function InstacartShoppingPanel({ items, listKey, disabled = false }: Props) {
  const t = useT();
  const title = t("shopping.instacartTitle");
  // Each input snapshot owns its request and link. Replacing it also cancels pending work.
  return (
    <InstacartSession
      key={JSON.stringify([listKey, items, disabled, title])}
      items={items}
      title={title}
      disabled={disabled}
    />
  );
}

function InstacartSession({ items, title, disabled }: Omit<Props, "listKey"> & { title: string }) {
  const t = useT();
  const apiClient = useApiClient();
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"creating" | "opening" | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const unavailable = disabled || items.length === 0;

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);

  const createLink = async () => {
    if (!active.current || busy.current || unavailable || url) return;
    busy.current = true;
    setPhase("creating");
    setErrorKey(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await apiClient.shopping.createInstacartLink(
        { title, items },
        { signal: controller.signal },
      );
      if (!active.current || controller.signal.aborted) return;
      if (!isSafeInstacartUrl(result.url)) {
        setErrorKey("shopping.instacartFailed");
        return;
      }
      setUrl(result.url);
    } catch (error) {
      if (!active.current || controller.signal.aborted) return;
      const code = error instanceof ApiError ? error.code : undefined;
      setErrorKey(code === "instacart_not_configured"
        ? "shopping.instacartNotConfigured"
        : code === "instacart_rate_limited"
          ? "shopping.instacartRateLimited"
          : "shopping.instacartFailed");
    } finally {
      if (active.current) {
        busy.current = false;
        request.current = null;
        setPhase(null);
      }
    }
  };

  const openLink = async () => {
    if (!active.current || busy.current || unavailable || !url) return;
    if (!isSafeInstacartUrl(url)) {
      setUrl(null);
      setErrorKey("shopping.instacartFailed");
      return;
    }
    busy.current = true;
    setPhase("opening");
    setErrorKey(null);
    try {
      await Linking.openURL(url);
    } catch {
      if (active.current) setErrorKey("shopping.instacartOpenFailed");
    } finally {
      if (active.current) {
        busy.current = false;
        setPhase(null);
      }
    }
  };

  const buttonLabel = t(phase === "creating"
    ? "shopping.instacartCreating"
    : url ? "shopping.instacartOpen" : "shopping.instacartCreate");
  const buttonDisabled = unavailable || phase !== null;

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.body}>{t("shopping.instacartDescription")}</Text>
      <Text style={styles.review}>{t("shopping.instacartReview")}</Text>
      {disabled ? <Text style={styles.hint}>{t("shopping.instacartRefresh")}</Text> : null}
      {!disabled && items.length === 0 ? (
        <Text style={styles.hint}>{t("shopping.instacartEmpty")}</Text>
      ) : null}
      {url ? <Text style={styles.hint}>{t("shopping.instacartReady")}</Text> : null}
      {errorKey ? (
        <Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
        accessibilityState={{ disabled: buttonDisabled, busy: phase !== null }}
        disabled={buttonDisabled}
        onPress={() => void (url ? openLink() : createLink())}
        style={({ pressed }) => [
          styles.button,
          buttonDisabled && styles.disabled,
          pressed && !buttonDisabled && styles.pressed,
        ]}
      >
        {phase ? (
          <ActivityIndicator color={colors.instacartForeground} />
        ) : (
          <Image
            source={require("../../../assets/instacart-logo.png")}
            style={styles.logo}
            resizeMode="contain"
            accessible={false}
          />
        )}
        <Text style={styles.buttonLabel}>{buttonLabel}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  heading: { ...typography.title3, color: colors.onSurface, marginBottom: spacing.xs },
  body: { ...typography.subhead, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
  review: { ...typography.caption, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  hint: { ...typography.caption, color: colors.onSurfaceVariant, marginBottom: spacing.sm },
  error: { ...typography.subhead, color: colors.error, marginBottom: spacing.sm },
  button: {
    backgroundColor: colors.instacartBackground,
    minHeight: 46,
    borderRadius: 29.5,
    paddingHorizontal: 18,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  buttonLabel: { ...typography.headline, color: colors.instacartForeground, flexShrink: 1 },
  logo: { width: 22, height: 22 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
