import React, { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, typography } from "../theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  leadingIcon?: IoniconName;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, leadingIcon, style, ...inputProps },
  ref,
) {
  const hasError = Boolean(error);
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.box, hasError && styles.boxError]}>
        {leadingIcon ? (
          <Ionicons
            name={leadingIcon}
            size={18}
            color={colors.onSurfaceVariant}
            style={styles.leading}
          />
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.onSurfaceVariant}
          selectionColor={colors.primary}
          clearButtonMode={inputProps.secureTextEntry ? "never" : "while-editing"}
          autoCorrect={inputProps.keyboardType === "email-address" ? false : inputProps.autoCorrect}
          autoCapitalize={inputProps.keyboardType === "email-address" ? "none" : inputProps.autoCapitalize}
          returnKeyType={inputProps.returnKeyType ?? "done"}
          style={[styles.input, style]}
          {...inputProps}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: {
    ...typography.footnote,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
    fontWeight: "600",
  },
  box: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  boxError: { borderColor: colors.error },
  leading: { marginRight: spacing.sm },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.onSurface,
    paddingVertical: spacing.md,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
