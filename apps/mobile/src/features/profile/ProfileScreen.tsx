import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { useI18n, useT } from "../../lib/i18n";
import { ListRow, Screen, SegmentedControl } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import type { ProfileStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "Profile">;

export function ProfileScreen({ navigation }: Props) {
  const { user, setLibraryVisibility } = useAuth();
  const { language, setLanguage } = useI18n();
  const t = useT();
  const [pending, setPending] = useState(false);

  const onToggle = async (next: boolean) => {
    if (pending || !user) return;
    setPending(true);
    try {
      await setLibraryVisibility(next);
    } catch (e) {
      Alert.alert(t("account.updateFailed"), e instanceof Error ? e.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Screen scroll padded={false}>
      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={28} color={colors.onPrimaryFixed} />
        </View>
        <Text style={styles.email}>{user?.email ?? ""}</Text>
      </View>

      <View style={styles.group}>
        <ListRow
          title={t("account.shareLibrary")}
          subtitle={t("account.shareLibraryDescription")}
          leading={<Ionicons name="people-outline" size={20} color={colors.primary} />}
          trailing={
            <Switch
              value={user?.is_library_public ?? false}
              onValueChange={(next) => void onToggle(next)}
              disabled={pending || !user}
            />
          }
        />
        <ListRow
          title={t("nav.settings")}
          leading={<Ionicons name="settings-outline" size={20} color={colors.primary} />}
          onPress={() => navigation.navigate("Settings")}
        />
      </View>

      <View style={styles.language}>
        <SegmentedControl
          label={t("account.language")}
          value={language}
          options={[
            { value: "en", label: t("language.english") },
            { value: "zh", label: t("language.chinese") },
          ]}
          onChange={setLanguage}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  email: { ...typography.headline, color: colors.onSurface },
  group: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  language: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
});
