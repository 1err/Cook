import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useShareIntentContext } from "expo-share-intent";
import { useAuth } from "../lib/auth";
import { AuthStack } from "./AuthStack";
import { MainTabs } from "./MainTabs";
import { ImportModalScreen } from "../features/import/ImportModalScreen";
import { SettingsScreen } from "../features/profile/SettingsScreen";
import { extractSharedVideoUrl } from "../features/import/sharedVideoUrl";
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
  const { token, user, loading } = useAuth();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const accountKey = user?.id ?? (token ? "authenticated" : "anonymous");
  const verificationRequired = user?.email_verification_required === true && !user.email_verified;
  const navigationKey = `${accountKey}:${verificationRequired ? "verify" : "app"}`;
  const [navigationReady, setNavigationReady] = useState<string | null>(null);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const consumedIntentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasShareIntent) {
      consumedIntentKeyRef.current = null;
      return;
    }

    if (
      loading ||
      !token ||
      verificationRequired ||
      navigationReady !== navigationKey ||
      !navigationRef.isReady()
    ) {
      return;
    }

    const intentKey = JSON.stringify([
      shareIntent.type,
      shareIntent.webUrl,
      shareIntent.text,
    ]);
    if (consumedIntentKeyRef.current === intentKey) return;

    const initialUrl = extractSharedVideoUrl(shareIntent.webUrl, shareIntent.text);
    consumedIntentKeyRef.current = intentKey;
    if (initialUrl) {
      navigationRef.navigate("ImportModal", { initialUrl });
    }
    resetShareIntent();
  }, [
    hasShareIntent,
    loading,
    navigationReady,
    navigationKey,
    navigationRef,
    resetShareIntent,
    shareIntent.text,
    shareIntent.type,
    shareIntent.webUrl,
    token,
    verificationRequired,
  ]);

  if (loading) return <SplashGate />;

  return (
    <NavigationContainer key={navigationKey} ref={navigationRef} onReady={() => setNavigationReady(navigationKey)}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!token ? (
          <Stack.Screen name="Auth" component={AuthStack} />
        ) : verificationRequired ? (
          <Stack.Screen name="VerifyEmail" component={SettingsScreen} />
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
