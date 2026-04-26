import React, { useState } from "react";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { RootStackParamList } from "../../App";
import { useAuth } from "../lib/auth";
import { sharedStyles } from "./shared";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={sharedStyles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={sharedStyles.container}>
      <Text style={sharedStyles.title}>Welcome back</Text>
      {error ? <Text style={sharedStyles.error}>{error}</Text> : null}
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        style={sharedStyles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        style={sharedStyles.input}
      />
      <Pressable style={sharedStyles.button} onPress={() => void handleSubmit()} disabled={submitting}>
        <Text style={sharedStyles.buttonText}>{submitting ? "Signing in..." : "Sign in"}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate("Register")}>
        <Text style={sharedStyles.textButton}>Create account</Text>
      </Pressable>
    </View>
  );
}
