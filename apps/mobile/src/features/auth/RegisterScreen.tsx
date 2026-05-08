import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../../lib/auth";
import { Button, Screen, TextField } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<AuthStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
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
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Start a private library of your favorite recipes</Text>
      </View>

      <View style={styles.form}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          leadingIcon="mail-outline"
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          placeholder="At least 8 characters"
          returnKeyType="go"
          onSubmitEditing={() => void handleSubmit()}
          leadingIcon="lock-closed-outline"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button
            title="Create account"
            onPress={() => void handleSubmit()}
            loading={submitting}
            fullWidth
            size="lg"
          />
          <Button
            title="Back to sign in"
            onPress={() => navigation.navigate("Login")}
            variant="ghost"
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing["2xl"] },
  title: { ...typography.title1, color: colors.onSurface },
  subtitle: { ...typography.body, color: colors.onSurfaceVariant, marginTop: spacing.xs },
  form: { marginTop: spacing.lg },
  error: {
    ...typography.subhead,
    color: colors.error,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
});
