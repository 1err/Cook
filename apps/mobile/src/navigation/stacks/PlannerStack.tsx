import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CoreHeaderActions } from "../../components/CoreHeaderActions";
import { PlannerWeekScreen } from "../../features/planner/PlannerWeekScreen";
import { useT } from "../../lib/i18n";
import { coreStackScreenOptions } from "../coreStackOptions";
import type { PlannerStackParamList } from "../types";

const Stack = createNativeStackNavigator<PlannerStackParamList>();

export function PlannerStack() {
  const t = useT();

  return (
    <Stack.Navigator screenOptions={coreStackScreenOptions}>
      <Stack.Screen
        name="PlannerWeek"
        component={PlannerWeekScreen}
        options={{ title: t("nav.planner"), headerRight: () => <CoreHeaderActions /> }}
      />
    </Stack.Navigator>
  );
}
