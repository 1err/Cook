import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ApiError } from "@cooking/api-client";
import { BETA_FEEDBACK_URL } from "@cooking/shared";
import { buildClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Button, Screen, TextField } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<AuthStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation, route }: Props) {
  const client = useMemo(() => buildClient(null), []);
  const t = useT();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(0);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setAvailable(null);
    void client.auth.capabilities().then(
      (capabilities) => { if (active) setAvailable(capabilities.password_recovery); },
      () => { if (active) setAvailable(false); },
    );
    return () => { active = false; };
  }, [checking, client]);

  async function sendReset() {
    if (!available || !email.trim() || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setSent(false);
    setErrorKey(null);
    try {
      const response = await client.auth.requestPasswordReset(email.trim());
      if (!response.ok) throw new Error("Reset request was not accepted");
      if (mounted.current) setSent(true);
    } catch (error) {
      if (mounted.current) setErrorKey(error instanceof ApiError && error.status === 429
        ? "account.tooManyRequests"
        : error instanceof ApiError && error.status === 503
          ? "account.emailUnavailable" : "account.tryAgain");
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function openSupport() {
    try { await Linking.openURL(BETA_FEEDBACK_URL); }
    catch { if (mounted.current) setErrorKey("account.emailOpenFailed"); }
  }

  return (
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{t("account.forgotPassword")}</Text>
      <Text style={styles.help}>{t("account.resetHelp")}</Text>
      <TextField label={t("common.email")} value={email} onChangeText={(value) => { setEmail(value); setSent(false); }} keyboardType="email-address" textContentType="emailAddress" autoCapitalize="none" editable={!pending} returnKeyType="send" onSubmitEditing={() => void sendReset()} />
      {available === false ? (
        <View style={styles.actions}>
          <Text style={styles.help}>{t("account.emailUnavailable")}</Text>
          <Button title={t("account.retry")} onPress={() => setChecking((value) => value + 1)} variant="ghost" />
        </View>
      ) : null}
      {errorKey ? <Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text> : null}
      {sent ? <Text accessibilityLiveRegion="polite" style={styles.help}>{t("account.resetSent")}</Text> : null}
      <Button title={t("account.sendReset")} onPress={() => void sendReset()} loading={pending} disabled={!available || !email.trim()} fullWidth />
      <Button title={t("common.back")} onPress={() => navigation.goBack()} variant="ghost" fullWidth />
      <Button title={t("account.support")} onPress={() => void openSupport()} variant="ghost" fullWidth />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.xl },
  heading: { ...typography.title2, color: colors.onSurface },
  help: { ...typography.body, color: colors.onSurfaceVariant },
  error: { ...typography.subhead, color: colors.error },
  actions: { gap: spacing.sm },
});
