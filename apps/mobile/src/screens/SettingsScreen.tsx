import React from "react";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { sharedStyles } from "./shared";

export function SettingsScreen() {
  const { user, logout } = useAuth();
  return (
    <View style={sharedStyles.container}>
      <Text style={sharedStyles.title}>Settings</Text>
      <Text style={{ marginBottom: 20, color: "#55423e" }}>{user?.email}</Text>
      <Pressable style={sharedStyles.button} onPress={() => void logout()}>
        <Text style={sharedStyles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}
