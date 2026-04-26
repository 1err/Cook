import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function PlaceholderScreen({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

export const sharedStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#faf9f8",
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1c1c",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#dbc1ba",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#9a442d",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  textButton: {
    color: "#9a442d",
    fontWeight: "600",
  },
  error: {
    color: "#ba1a1a",
    marginBottom: 10,
  },
  recipeCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  recipeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1c1c",
  },
  recipeSub: {
    marginTop: 6,
    color: "#55423e",
  },
});

const styles = StyleSheet.create({
  container: sharedStyles.container,
  title: sharedStyles.title,
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: "#55423e",
  },
});
