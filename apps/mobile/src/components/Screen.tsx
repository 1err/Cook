import React, { type ReactElement, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  keyboardAvoiding?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  backgroundColor?: string;
  edges?: readonly Edge[];
  contentContainerStyle?: ViewStyle;
};

export function Screen({
  children,
  scroll = false,
  padded = true,
  keyboardAvoiding = false,
  refreshControl,
  backgroundColor = colors.background,
  edges = ["top", "left", "right"],
  contentContainerStyle,
}: ScreenProps) {
  const padStyle = padded ? styles.padded : undefined;

  let inner: ReactNode;
  if (scroll) {
    inner = (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[padStyle, contentContainerStyle]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    );
  } else {
    inner = <View style={[styles.flex, padStyle, contentContainerStyle]}>{children}</View>;
  }

  if (keyboardAvoiding) {
    inner = (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {inner}
      </KeyboardAvoidingView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor }]} edges={edges}>
      {inner}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { padding: spacing.lg },
});
