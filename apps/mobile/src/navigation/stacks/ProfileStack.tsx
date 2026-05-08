import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ProfileScreen } from "../../features/profile/ProfileScreen";
import { SettingsScreen } from "../../features/profile/SettingsScreen";
import { colors } from "../../theme";
import type { ProfileStackParamList } from "../types";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerLargeStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.onSurface },
        headerLargeTitleStyle: { color: colors.onSurface },
      }}
    >
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Settings", headerLargeTitle: false }}
      />
    </Stack.Navigator>
  );
}
