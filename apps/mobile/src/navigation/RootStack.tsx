import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../lib/auth";
import { AuthStack } from "./AuthStack";
import { MainTabs } from "./MainTabs";
import { ImportModalScreen } from "../features/import/ImportModalScreen";
import { AccountStack } from "./stacks/AccountStack";
import { colors } from "../theme";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

function SplashGate() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

export function RootStack() {
  const { token, loading } = useAuth();

  if (loading) return <SplashGate />;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="Account"
              component={AccountStack}
              options={{ presentation: "modal", headerShown: false }}
            />
            <Stack.Screen
              name="ImportModal"
              component={ImportModalScreen}
              options={{
                presentation: "modal",
                headerShown: true,
                title: "Import recipe",
                headerStyle: { backgroundColor: colors.surface },
                headerTitleStyle: { color: colors.onSurface },
                headerTintColor: colors.primary,
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
