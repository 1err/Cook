import React, { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { useT } from "../../lib/i18n";
import { Button, Screen } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";

export function SettingsScreen() {
  const { user, logout } = useAuth();
  const t = useT();
  const [signingOut, setSigningOut] = useState(false);

  function confirmLogout() {
    Alert.alert(t("account.signOutConfirmTitle"), t("account.signOutConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("account.signOut"),
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await logout();
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen scroll padded contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <View style={styles.iconBubble}>
          <Ionicons name="mail-outline" size={20} color={colors.onPrimaryFixed} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{t("nav.account")}</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {user?.email ?? ""}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title={t("account.signOut")}
          onPress={confirmLogout}
          variant="destructive"
          loading={signingOut}
          fullWidth
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
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
  actions: { marginTop: spacing.lg },
});
