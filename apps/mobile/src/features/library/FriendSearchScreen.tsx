import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useApiClient } from "../../lib/api";
import { Button, EmptyState, TextField } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import type {
  LibraryStackParamList,
  MainTabsParamList,
  RootStackParamList,
} from "../../navigation/types";

type Props = CompositeScreenProps<
  NativeStackScreenProps<LibraryStackParamList, "FriendSearch">,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabsParamList, "Library">,
    NativeStackScreenProps<RootStackParamList>
  >
>;

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; user: { id: string; email: string } }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

export function FriendSearchScreen({ navigation }: Props) {
  const apiClient = useApiClient();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const handleSearch = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setResult({ kind: "error", message: "Enter an email." });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const user = await apiClient.users.searchByEmail(trimmed);
      setResult({ kind: "found", user });
    } catch (e) {
      // The api-client throws Error with the response body for non-2xx.
      // 404 → uniform "no public library" message; anything else surfaces raw.
      const message = e instanceof Error ? e.message : "Search failed";
      if (/not found|404|no public library/i.test(message)) {
        setResult({ kind: "not-found" });
      } else {
        setResult({ kind: "error", message });
      }
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.inputBlock}>
        <TextField
          label="Friend's email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="friend@example.com"
        />
        <Button
          title={result.kind === "loading" ? "Searching…" : "Search"}
          onPress={() => void handleSearch()}
          loading={result.kind === "loading"}
          disabled={result.kind === "loading"}
          fullWidth
        />
      </View>
      <View style={styles.resultBlock}>
        {result.kind === "found" ? (
          <Pressable
            onPress={() =>
              navigation.navigate("FriendLibrary", {
                userId: result.user.id,
                email: result.user.email,
              })
            }
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.avatar}>
              <Ionicons name="person" size={20} color={colors.onPrimaryFixed} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {result.user.email}
              </Text>
              <Text style={styles.cardSub}>Open library</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        ) : null}
        {result.kind === "not-found" ? (
          <EmptyState
            icon="person-outline"
            title="No public library for that email"
            description="Either no one with that email has shared their library, or the email doesn't match an account here."
          />
        ) : null}
        {result.kind === "error" ? <Text style={styles.error}>{result.message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  inputBlock: { padding: spacing.lg, gap: spacing.md },
  resultBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cardPressed: { opacity: 0.92 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.headline, color: colors.onSurface },
  cardSub: { ...typography.subhead, color: colors.onSurfaceVariant, marginTop: 2 },
  error: { ...typography.body, color: colors.error },
});
