import React, { useState } from "react";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, Text, TextInput, View } from "react-native";
import type { RootStackParamList } from "../../App";
import { useAuth } from "../lib/auth";
import { sharedStyles } from "./shared";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
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
      await register(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={sharedStyles.container}>
      <Text style={sharedStyles.title}>Create your account</Text>
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
        placeholder="Password (min 8 chars)"
        style={sharedStyles.input}
      />
      <Pressable style={sharedStyles.button} onPress={() => void handleSubmit()} disabled={submitting}>
        <Text style={sharedStyles.buttonText}>{submitting ? "Creating..." : "Create account"}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate("Login")}>
        <Text style={sharedStyles.textButton}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}
