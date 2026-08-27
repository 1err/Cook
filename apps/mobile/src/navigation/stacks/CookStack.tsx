import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CoreHeaderActions } from "../../components/CoreHeaderActions";
import { CookScreen } from "../../features/cook/CookScreen";
import { useT } from "../../lib/i18n";
import { coreStackScreenOptions } from "../coreStackOptions";
import type { CookStackParamList } from "../types";

const Stack = createNativeStackNavigator<CookStackParamList>();

export function CookStack() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={coreStackScreenOptions}>
      <Stack.Screen
        component={CookScreen}
        name="CookHome"
        options={{ title: t("nav.cook"), headerRight: () => <CoreHeaderActions /> }}
      />
    </Stack.Navigator>
  );
}
