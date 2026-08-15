import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CoreHeaderActions } from "../../components/CoreHeaderActions";
import { ShoppingListScreen } from "../../features/shopping/ShoppingListScreen";
import { useT } from "../../lib/i18n";
import { coreStackScreenOptions } from "../coreStackOptions";
import type { ShoppingStackParamList } from "../types";

const Stack = createNativeStackNavigator<ShoppingStackParamList>();

export function ShoppingStack() {
  const t = useT();

  return (
    <Stack.Navigator screenOptions={coreStackScreenOptions}>
      <Stack.Screen
        name="ShoppingList"
        component={ShoppingListScreen}
        options={{ title: t("nav.shopping"), headerRight: () => <CoreHeaderActions /> }}
      />
    </Stack.Navigator>
  );
}
