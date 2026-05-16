import { View, TextInput, Text } from "react-native";
import { typography, spacing, colors, radii } from "../../theme";

interface Props {
  seconds: number | null | undefined;
  onChange: (next: number | null) => void;
}

export function DurationField({ seconds, onChange }: Props) {
  const total = seconds ?? 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  const update = (nextM: number, nextS: number) => {
    const t = Math.max(0, Math.floor(nextM)) * 60 + Math.max(0, Math.min(59, Math.floor(nextS)));
    onChange(t > 0 ? t : null);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <TextInput
        style={[typography.body, {
          width: 44,
          textAlign: "center",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.sm,
          paddingVertical: spacing.xs,
        }]}
        keyboardType="number-pad"
        value={String(m)}
        onChangeText={(v) => update(Number(v) || 0, s)}
      />
      <Text style={typography.body}>:</Text>
      <TextInput
        style={[typography.body, {
          width: 44,
          textAlign: "center",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.sm,
          paddingVertical: spacing.xs,
        }]}
        keyboardType="number-pad"
        value={s.toString().padStart(2, "0")}
        onChangeText={(v) => update(m, Number(v) || 0)}
      />
    </View>
  );
}
