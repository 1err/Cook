import React, { useEffect, useState } from "react";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { RootStackParamList } from "../../App";
import type { Recipe } from "@cooking/shared";
import { useMobileApiClient } from "../lib/auth";
import { sharedStyles } from "./shared";

type Props = NativeStackScreenProps<RootStackParamList, "RecipeDetail">;

export function RecipeDetailScreen({ route }: Props) {
  const apiClient = useMobileApiClient();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const row = await apiClient.recipes.get(route.params.recipeId);
        setRecipe(row);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load recipe");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [apiClient, route.params.recipeId]);

  if (loading) {
    return (
      <View style={sharedStyles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !recipe) {
    return (
      <View style={sharedStyles.container}>
        <Text style={sharedStyles.error}>{error || "Recipe not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={sharedStyles.container}>
      <Text style={sharedStyles.title}>{recipe.title}</Text>
      {recipe.ingredients.map((ingredient, index) => (
        <Text key={`${ingredient.name}-${index}`} style={{ marginBottom: 6, color: "#1a1c1c" }}>
          • {ingredient.name} {ingredient.quantity}
        </Text>
      ))}
    </ScrollView>
  );
}
