import { View, TextInput, Text } from "react-native";
import { typography, spacing, colors, radii } from "../../theme";

interface Props {
  minutes: number | null | undefined;
  onChange: (next: number | null) => void;
  suffix: string;
}

export function TotalTimeField({ minutes, onChange, suffix }: Props) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <TextInput
        style={[typography.body, {
          width: 80,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.sm,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.sm,
          textAlign: "center",
        }]}
        keyboardType="number-pad"
        value={minutes == null ? "" : String(minutes)}
        onChangeText={(v) => {
          if (v === "") return onChange(null);
          const n = Math.max(0, Math.floor(Number(v) || 0));
          onChange(n);
        }}
      />
      <Text style={typography.body}>{suffix}</Text>
    </View>
  );
}
