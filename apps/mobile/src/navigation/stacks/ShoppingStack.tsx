import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ShoppingListScreen } from "../../features/shopping/ShoppingListScreen";
import { colors } from "../../theme";
import type { ShoppingStackParamList } from "../types";

const Stack = createNativeStackNavigator<ShoppingStackParamList>();

export function ShoppingStack() {
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
      <Stack.Screen name="ShoppingList" component={ShoppingListScreen} options={{ title: "Shopping" }} />
    </Stack.Navigator>
  );
}
