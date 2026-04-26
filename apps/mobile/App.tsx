import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/lib/auth";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { RecipeDetailScreen } from "./src/screens/RecipeDetailScreen";
import { ImportScreen } from "./src/screens/ImportScreen";
import { PlannerScreen } from "./src/screens/PlannerScreen";
import { ShoppingListScreen } from "./src/screens/ShoppingListScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Library: undefined;
  RecipeDetail: { recipeId: string };
  Import: undefined;
  Planner: undefined;
  ShoppingList: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { token } = useAuth();

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator>
        {!token ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Login" }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Register" }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Library" component={LibraryScreen} options={{ title: "Library" }} />
            <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} options={{ title: "Recipe" }} />
            <Stack.Screen name="Import" component={ImportScreen} options={{ title: "Import" }} />
            <Stack.Screen name="Planner" component={PlannerScreen} options={{ title: "Planner" }} />
            <Stack.Screen name="ShoppingList" component={ShoppingListScreen} options={{ title: "Shopping List" }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
