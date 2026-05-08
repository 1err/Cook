import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { LibraryStack } from "./stacks/LibraryStack";
import { PlannerStack } from "./stacks/PlannerStack";
import { ShoppingStack } from "./stacks/ShoppingStack";
import { ProfileStack } from "./stacks/ProfileStack";
import { colors } from "../theme";
import type { MainTabsParamList } from "./types";

const Tabs = createBottomTabNavigator<MainTabsParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const ICONS: Record<keyof MainTabsParamList, { active: IoniconName; inactive: IoniconName }> = {
  Library: { active: "book", inactive: "book-outline" },
  Planner: { active: "calendar", inactive: "calendar-outline" },
  Shopping: { active: "cart", inactive: "cart-outline" },
  ProfileTab: { active: "person", inactive: "person-outline" },
};

export function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIcon: ({ color, size, focused }) => {
          const name = ICONS[route.name as keyof MainTabsParamList];
          return <Ionicons name={focused ? name.active : name.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Library" component={LibraryStack} options={{ title: "Library" }} />
      <Tabs.Screen name="Planner" component={PlannerStack} options={{ title: "Planner" }} />
      <Tabs.Screen name="Shopping" component={ShoppingStack} options={{ title: "Shopping" }} />
      <Tabs.Screen name="ProfileTab" component={ProfileStack} options={{ title: "Profile" }} />
    </Tabs.Navigator>
  );
}
