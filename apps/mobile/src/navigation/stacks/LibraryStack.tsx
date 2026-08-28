import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { FriendLibraryScreen } from "../../features/library/FriendLibraryScreen";
import { FriendSearchScreen } from "../../features/library/FriendSearchScreen";
import { LibraryListScreen } from "../../features/library/LibraryListScreen";
import { RecipeDetailScreen } from "../../features/library/RecipeDetailScreen";
import { RecipeEditScreen } from "../../features/library/RecipeEditScreen";
import { IconButton } from "../../components";
import { CoreHeaderActions } from "../../components/CoreHeaderActions";
import { useT } from "../../lib/i18n";
import { coreStackScreenOptions } from "../coreStackOptions";
import type { LibraryStackParamList } from "../types";

const Stack = createNativeStackNavigator<LibraryStackParamList>();

export function LibraryStack() {
  const t = useT();

  return (
    <Stack.Navigator screenOptions={coreStackScreenOptions}>
      <Stack.Screen
        name="LibraryList"
        component={LibraryListScreen}
        options={({ navigation }) => ({
          title: t("nav.library"),
          headerRight: () => (
            <CoreHeaderActions
              before={
                <IconButton
                  icon="people-outline"
                  accessibilityLabel={t("nav.findFriend")}
                  onPress={() => navigation.navigate("FriendSearch")}
                />
              }
            />
          ),
        })}
      />
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
      <Stack.Screen
        name="FriendSearch"
        component={FriendSearchScreen}
        options={{ title: "Find a friend", headerLargeTitle: false }}
      />
      <Stack.Screen
        name="FriendLibrary"
        component={FriendLibraryScreen}
        options={({ route }) => ({ title: route.params.email, headerLargeTitle: false })}
      />
    </Stack.Navigator>
  );
}
