import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { PlannerWeekScreen } from "../../features/planner/PlannerWeekScreen";
import { colors } from "../../theme";
import type { PlannerStackParamList } from "../types";

const Stack = createNativeStackNavigator<PlannerStackParamList>();

export function PlannerStack() {
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
      <Stack.Screen name="PlannerWeek" component={PlannerWeekScreen} options={{ title: "Planner" }} />
    </Stack.Navigator>
  );
}
