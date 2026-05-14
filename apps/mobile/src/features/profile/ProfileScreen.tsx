import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { ListRow, Screen } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import type { ProfileStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ProfileStackParamList, "Profile">;

export function ProfileScreen({ navigation }: Props) {
  const { user, setLibraryVisibility } = useAuth();
  const [pending, setPending] = useState(false);

  const onToggle = async (next: boolean) => {
    if (pending || !user) return;
    setPending(true);
    try {
      await setLibraryVisibility(next);
    } catch (e) {
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Please try again.");
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
          title="Share my library"
          subtitle="Anyone who knows your email can browse and copy your recipes."
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
          title="Settings"
          leading={<Ionicons name="settings-outline" size={20} color={colors.primary} />}
          onPress={() => navigation.navigate("Settings")}
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
});
