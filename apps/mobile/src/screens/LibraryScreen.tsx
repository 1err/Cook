import React, { useCallback, useEffect, useState } from "react";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import type { RootStackParamList } from "../../App";
import type { Recipe } from "@cooking/shared";
import { useAuth, useMobileApiClient } from "../lib/auth";
import { sharedStyles } from "./shared";

type Props = NativeStackScreenProps<RootStackParamList, "Library">;

export function LibraryScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const apiClient = useMobileApiClient();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiClient.recipes.list();
      setRecipes(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipes");
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  return (
    <View style={sharedStyles.container}>
      <Text style={sharedStyles.title}>Your library</Text>
      <Text style={{ marginBottom: 12, color: "#55423e" }}>{user?.email}</Text>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        <Pressable style={sharedStyles.button} onPress={() => void loadRecipes()}>
          <Text style={sharedStyles.buttonText}>Refresh</Text>
        </Pressable>
        <Pressable style={sharedStyles.button} onPress={() => navigation.navigate("Import")}>
          <Text style={sharedStyles.buttonText}>Import</Text>
        </Pressable>
        <Pressable style={sharedStyles.button} onPress={() => navigation.navigate("Settings")}>
          <Text style={sharedStyles.buttonText}>Settings</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={sharedStyles.recipeCard} onPress={() => navigation.navigate("RecipeDetail", { recipeId: item.id })}>
            <Text style={sharedStyles.recipeTitle}>{item.title}</Text>
            <Text style={sharedStyles.recipeSub}>{item.ingredients.length} ingredients</Text>
          </Pressable>
        )}
        ListEmptyComponent={!loading ? <Text style={{ color: "#55423e" }}>No recipes yet.</Text> : null}
      />
      <Pressable onPress={() => void logout()}>
        <Text style={sharedStyles.textButton}>Log out</Text>
      </Pressable>
    </View>
  );
}
