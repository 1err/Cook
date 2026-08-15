import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { IconButton } from "../../components";
import { ProfileScreen } from "../../features/profile/ProfileScreen";
import { SettingsScreen } from "../../features/profile/SettingsScreen";
import { useT } from "../../lib/i18n";
import { coreStackScreenOptions } from "../coreStackOptions";
import type { ProfileStackParamList } from "../types";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function AccountStack() {
  const t = useT();

  return (
    <Stack.Navigator screenOptions={coreStackScreenOptions}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={({ navigation }) => ({
          title: t("nav.account"),
          headerLeft: () => (
            <IconButton
              icon="close"
              accessibilityLabel={t("account.close")}
              onPress={() => navigation.getParent()?.goBack()}
            />
          ),
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t("nav.settings"), headerLargeTitle: false }}
      />
    </Stack.Navigator>
  );
}
