import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../../lib/auth";
import { Button, Screen, TextField } from "../../components";
import { colors, spacing, typography } from "../../theme";
import type { AuthStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
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

  return (
    <Screen scroll keyboardAvoiding contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.brand}>Chef World</Text>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to your kitchen</Text>
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
          textContentType="password"
          placeholder="Your password"
          returnKeyType="go"
          onSubmitEditing={() => void handleSubmit()}
          leadingIcon="lock-closed-outline"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button
            title="Sign in"
            onPress={() => void handleSubmit()}
            loading={submitting}
            fullWidth
            size="lg"
          />
          <Button
            title="Create account"
            onPress={() => navigation.navigate("Register")}
            variant="ghost"
            fullWidth
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing["3xl"] },
  hero: { marginBottom: spacing["2xl"] },
  brand: {
    ...typography.footnote,
    color: colors.primary,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  title: { ...typography.largeTitle, color: colors.onSurface },
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
