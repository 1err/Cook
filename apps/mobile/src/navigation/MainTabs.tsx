import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { LibraryStack } from "./stacks/LibraryStack";
import { PlannerStack } from "./stacks/PlannerStack";
import { CookStack } from "./stacks/CookStack";
import { ShoppingStack } from "./stacks/ShoppingStack";
import { useT } from "../lib/i18n";
import { colors } from "../theme";
import type { MainTabsParamList } from "./types";

const Tabs = createBottomTabNavigator<MainTabsParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type MainTabDefinition = {
  name: keyof MainTabsParamList;
  labelKey: string;
  active: IoniconName;
  inactive: IoniconName;
};

export const MAIN_TAB_DEFINITIONS = [
  { name: "Library", labelKey: "nav.library", active: "book", inactive: "book-outline" },
  { name: "Planner", labelKey: "nav.planner", active: "calendar", inactive: "calendar-outline" },
  { name: "Shopping", labelKey: "nav.shopping", active: "cart", inactive: "cart-outline" },
  { name: "Cook", labelKey: "nav.cook", active: "restaurant", inactive: "restaurant-outline" },
] as const satisfies readonly MainTabDefinition[];

const TAB_COMPONENTS = {
  Library: LibraryStack,
  Planner: PlannerStack,
  Cook: CookStack,
  Shopping: ShoppingStack,
};

export function MainTabs() {
  const t = useT();

  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
        tabBarIcon: ({ color, size, focused }) => {
          const definition = MAIN_TAB_DEFINITIONS.find(({ name }) => name === route.name)!;
          return (
            <Ionicons
              name={focused ? definition.active : definition.inactive}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
      {MAIN_TAB_DEFINITIONS.map((definition) => (
        <Tabs.Screen
          key={definition.name}
          name={definition.name}
          component={TAB_COMPONENTS[definition.name]}
          options={{ title: t(definition.labelKey) }}
        />
      ))}
    </Tabs.Navigator>
  );
}
