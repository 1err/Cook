import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radii, spacing, typography } from "../../theme";

const MAX_DURATION_SECONDS = 86_400;

interface Props {
  seconds: number | null | undefined;
  onChange: (next: number | null) => void;
  minutesLabel: string;
  secondsLabel: string;
  validationMessage: string;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
}

function isValidDuration(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_DURATION_SECONDS
  );
}

function durationParts(value: number | null | undefined): [string, string] {
  if (!isValidDuration(value)) return ["", ""];
  return [String(Math.floor(value / 60)), String(value % 60).padStart(2, "0")];
}

export function DurationField({
  seconds,
  onChange,
  minutesLabel,
  secondsLabel,
  validationMessage,
  onValidityChange,
  disabled = false,
}: Props) {
  const initial = durationParts(seconds);
  const [minutes, setMinutes] = useState(initial[0]);
  const [secondsPart, setSecondsPart] = useState(initial[1]);
  const [valid, setValid] = useState(isValidDuration(seconds));

  useEffect(() => {
    const [nextMinutes, nextSeconds] = durationParts(seconds);
    setMinutes(nextMinutes);
    setSecondsPart(nextSeconds);
    setValid(isValidDuration(seconds));
  }, [seconds]);

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  const update = (nextMinutes: string, nextSeconds: string) => {
    setMinutes(nextMinutes);
    setSecondsPart(nextSeconds);

    if (nextMinutes.trim() === "" || nextSeconds.trim() === "") {
      setValid(false);
      return;
    }

    const parsedMinutes = Number(nextMinutes);
    const parsedSeconds = Number(nextSeconds);
    if (
      !Number.isInteger(parsedMinutes) ||
      !Number.isInteger(parsedSeconds) ||
      parsedMinutes < 0 ||
      parsedSeconds < 0
    ) {
      setValid(false);
      return;
    }

    const nextTotal = Math.min(
      MAX_DURATION_SECONDS,
      parsedMinutes * 60 + Math.min(59, parsedSeconds),
    );
    if (nextTotal < 1) {
      setValid(false);
      return;
    }

    const [clampedMinutes, clampedSeconds] = durationParts(nextTotal);
    setMinutes(clampedMinutes);
    setSecondsPart(clampedSeconds);
    setValid(true);
    onChange(nextTotal);
  };

  return (
    <View>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={minutesLabel}
          aria-invalid={!valid}
          editable={!disabled}
          keyboardType="number-pad"
          selectTextOnFocus
          style={[styles.input, disabled && styles.disabled]}
          value={minutes}
          onChangeText={(value) => update(value, secondsPart)}
        />
        <Text style={styles.separator}>:</Text>
        <TextInput
          accessibilityLabel={secondsLabel}
          aria-invalid={!valid}
          editable={!disabled}
          keyboardType="number-pad"
          selectTextOnFocus
          style={[styles.input, disabled && styles.disabled]}
          value={secondsPart}
          onChangeText={(value) => update(minutes, value)}
        />
      </View>
      {!valid ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {validationMessage}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  input: {
    ...typography.body,
    color: colors.ink,
    minWidth: 52,
    minHeight: 44,
    textAlign: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  separator: { ...typography.body, color: colors.mutedInk },
  disabled: { opacity: 0.5 },
  error: { ...typography.caption, color: colors.error, marginTop: spacing.xs },
});
