import "react-native-gesture-handler";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
} from "@expo-google-fonts/source-serif-4";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useFonts } from "expo-font";
import { ShareIntentProvider } from "expo-share-intent";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "./src/lib/auth";
import { I18nProvider } from "./src/lib/i18n";
import { RootStack } from "./src/navigation/RootStack";
import { colors } from "./src/theme";

function FontSplashGate() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color={colors.terracotta} />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    SourceSerif4_400Regular,
    SourceSerif4_600SemiBold,
  });

  return (
    <ShareIntentProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <BottomSheetModalProvider>
            {fontsLoaded ? (
              <I18nProvider>
                <AuthProvider>
                  <StatusBar style="dark" />
                  <RootStack />
                </AuthProvider>
              </I18nProvider>
            ) : (
              <>
                <StatusBar style="dark" />
                <FontSplashGate />
              </>
            )}
          </BottomSheetModalProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
});
