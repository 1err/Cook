import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ApiError } from "@cooking/api-client";
import { BETA_FEEDBACK_URL, PRIVACY_URL } from "@cooking/shared";
import { useAuth } from "../../lib/auth";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Button, Screen, TextField } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";

type Action = "logout" | "logoutAll" | "delete" | "verify" | "refresh";

export function SettingsScreen() {
  const { user, logout, logoutAll, deleteAccount, refreshUser } = useAuth();
  const client = useApiClient();
  const t = useT();
  const verificationRequired = user?.email_verification_required === true && !user.email_verified;
  const [emailAvailable, setEmailAvailable] = useState<boolean | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const accountId = useRef(user?.id);
  accountId.current = user?.id;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setEmailAvailable(null);
    void client.auth.capabilities().then(
      (capabilities) => { if (active) setEmailAvailable(capabilities.email_verification); },
      () => { if (active) setEmailAvailable(false); },
    );
    return () => { active = false; };
  }, [client]);

  async function perform(action: Action) {
    if (pendingRef.current || !mounted.current) return;
    const startedFor = user?.id;
    if (accountId.current !== startedFor) return;
    pendingRef.current = true;
    setPending(action);
    setErrorKey(null);
    setMessageKey(null);
    try {
      if (action === "logout") await logout();
      else if (action === "logoutAll") await logoutAll();
      else if (action === "delete") await deleteAccount(password);
      else if (action === "refresh") {
        const [, capabilities] = await Promise.all([refreshUser(), client.auth.capabilities()]);
        if (mounted.current && accountId.current === startedFor) setEmailAvailable(capabilities.email_verification);
      }
      else {
        await client.auth.requestEmailVerification();
        if (mounted.current && accountId.current === startedFor) setMessageKey("account.verificationSent");
      }
    } catch (error) {
      if (!mounted.current || accountId.current !== startedFor) return;
      const key = action === "delete" && error instanceof ApiError && error.status === 403
        ? "account.passwordIncorrect"
        : error instanceof ApiError && error.status === 429
          ? "account.tooManyRequests"
          : action === "logout" || action === "logoutAll"
            ? "account.logoutServerFailed"
            : action === "verify" && error instanceof ApiError && error.status === 503
              ? "account.emailUnavailable"
              : "account.tryAgain";
      setErrorKey(key);
    } finally {
      pendingRef.current = false;
      if (mounted.current && accountId.current === startedFor) setPending(null);
    }
  }

  function confirmAction(action: "logout" | "logoutAll" | "delete") {
    if (pendingRef.current || (action === "delete" && (!password || !confirmed))) return;
    const title = action === "logout" ? "account.signOutConfirmTitle" : action === "logoutAll" ? "account.logoutAll" : "account.deleteTitle";
    const body = action === "logout" ? "account.signOutConfirmBody" : action === "logoutAll" ? "account.logoutAllHelp" : "account.deleteHelp";
    const button = action === "logout" ? "account.signOut" : action === "logoutAll" ? "account.logoutAll" : "account.deletePermanently";
    Alert.alert(t(title), t(body), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t(button), style: "destructive", onPress: () => perform(action) },
    ]);
  }

  async function openLink(url: string) {
    try { await Linking.openURL(url); }
    catch { if (mounted.current) setErrorKey(url === BETA_FEEDBACK_URL ? "account.emailOpenFailed" : "account.tryAgain"); }
  }

  return (
    <Screen scroll padded keyboardAvoiding contentContainerStyle={styles.content}>
      {verificationRequired ? (
        <View style={styles.actions}>
          <Text accessibilityRole="header" style={styles.title}>{t("account.verificationRequired")}</Text>
          <Text style={styles.help}>{t("account.verificationHelp")}</Text>
          <Text style={styles.help}>{t("account.checkInboxTips")}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.iconBubble}>
          <Ionicons name="mail-outline" size={20} color={colors.onPrimaryFixed} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{t("nav.account")}</Text>
          <Text style={styles.rowValue}>{user?.email ?? ""}</Text>
          <Text style={styles.help}>{t(user?.email_verified ? "account.verified" : "account.notVerified")}</Text>
        </View>
      </View>

      {errorKey ? <Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text> : null}
      {messageKey ? <Text accessibilityLiveRegion="polite" style={styles.help}>{t(messageKey)}</Text> : null}
      {!user?.email_verified ? (
        <View style={styles.actions}>
          {emailAvailable === false ? <Text style={styles.help}>{t("account.emailUnavailable")}</Text> : null}
          <Button title={t("account.verifyEmail")} onPress={() => void perform("verify")} variant="secondary" disabled={!emailAvailable || pending !== null} loading={pending === "verify"} fullWidth />
          <Button title={t("account.checkVerification")} onPress={() => void perform("refresh")} variant="ghost" disabled={pending !== null} loading={pending === "refresh"} fullWidth />
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title={t("account.signOut")} onPress={() => confirmAction("logout")} variant="secondary" disabled={pending !== null} loading={pending === "logout"} fullWidth />
        <Button title={t("account.logoutAll")} onPress={() => confirmAction("logoutAll")} variant="secondary" disabled={pending !== null} loading={pending === "logoutAll"} fullWidth />
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>{t("account.deleteTitle")}</Text>
        <Text style={styles.help}>{t("account.deleteHelp")}</Text>
        <TextField label={t("account.currentPassword")} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoCapitalize="none" editable={pending === null} />
        <Pressable accessibilityRole="checkbox" accessibilityLabel={t("account.deleteConfirm")} accessibilityState={{ checked: confirmed, disabled: pending !== null }} disabled={pending !== null} onPress={() => setConfirmed(!confirmed)} style={styles.confirmation}>
          <Ionicons name={confirmed ? "checkbox" : "square-outline"} size={24} color={colors.primary} />
          <Text style={styles.confirmLabel}>{t("account.deleteConfirm")}</Text>
        </Pressable>
        <Button title={t("account.deletePermanently")} onPress={() => confirmAction("delete")} variant="destructive" disabled={!password || !confirmed || pending !== null} loading={pending === "delete"} fullWidth />
      </View>

      <View style={styles.actions}>
        <Button title={t("account.support")} onPress={() => void openLink(BETA_FEEDBACK_URL)} variant="ghost" fullWidth />
        <Button title={t("account.privacy")} onPress={() => void openLink(PRIVACY_URL)} variant="ghost" fullWidth />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.md,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  rowBody: { flex: 1 },
  rowLabel: { ...typography.footnote, color: colors.onSurfaceVariant, fontWeight: "600" },
  rowValue: { ...typography.body, color: colors.onSurface, marginTop: 2 },
  actions: { gap: spacing.sm },
  card: { backgroundColor: colors.white, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  heading: { ...typography.headline, color: colors.onSurface },
  title: { ...typography.title1, color: colors.onSurface },
  help: { ...typography.subhead, color: colors.onSurfaceVariant },
  error: { ...typography.subhead, color: colors.error },
  confirmation: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  confirmLabel: { ...typography.subhead, color: colors.onSurface, flex: 1 },
});
