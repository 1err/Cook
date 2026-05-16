import { View, Text, TextInput, Pressable } from "react-native";
import { typography, spacing, colors, radii } from "../../theme";
import { Button } from "../../components";

interface Props {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

export function StringListEditor({ label, addLabel, placeholder, values, onChange }: Props) {
  const updateAt = (i: number, v: string) => {
    const arr = values.slice();
    arr[i] = v;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const append = () => onChange([...values, ""]);

  return (
    <View style={{ marginVertical: spacing.md }}>
      <Text style={typography.headline}>{label}</Text>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginVertical: spacing.xs,
          }}
        >
          <TextInput
            placeholder={placeholder}
            value={v}
            onChangeText={(next) => updateAt(i, next)}
            style={[
              typography.body,
              {
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.sm,
                padding: spacing.sm,
              },
            ]}
          />
          <Pressable onPress={() => removeAt(i)}>
            <Text style={[typography.body, { color: colors.error }]}>×</Text>
          </Pressable>
        </View>
      ))}
      <Button variant="ghost" onPress={append} title={`+ ${addLabel}`} />
    </View>
  );
}
