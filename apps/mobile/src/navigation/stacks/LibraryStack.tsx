import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { LibraryListScreen } from "../../features/library/LibraryListScreen";
import { RecipeDetailScreen } from "../../features/library/RecipeDetailScreen";
import { RecipeEditScreen } from "../../features/library/RecipeEditScreen";
import { colors } from "../../theme";
import type { LibraryStackParamList } from "../types";

const Stack = createNativeStackNavigator<LibraryStackParamList>();

export function LibraryStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTransparent: false,
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
        headerLargeStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.onSurface },
        headerLargeTitleStyle: { color: colors.onSurface },
      }}
    >
      <Stack.Screen name="LibraryList" component={LibraryListScreen} options={{ title: "Library" }} />
      <Stack.Screen
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={{ title: "", headerLargeTitle: false }}
      />
      <Stack.Screen
        name="RecipeEdit"
        component={RecipeEditScreen}
        options={{ title: "Edit recipe", presentation: "modal", headerLargeTitle: false }}
      />
    </Stack.Navigator>
  );
}
