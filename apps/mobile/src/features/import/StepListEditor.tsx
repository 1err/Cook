import { useState } from "react";
import { View, Text, TextInput, Pressable, Image, Alert } from "react-native";
import type { RecipeStep } from "@cooking/shared";
import { typography, spacing, colors, radii } from "../../theme";
import { Button } from "../../components";
import { haptics } from "../../lib/haptics";
import { DurationField } from "./DurationField";
import { resolveImageUrl } from "../../lib/imageUrl";

interface Props {
  steps: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
  pickImage: () => Promise<string | null>;
}

export function StepListEditor({ steps, onChange, pickImage }: Props) {
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  const updateAt = (i: number, next: RecipeStep) => {
    const arr = steps.slice();
    arr[i] = next;
    onChange(arr);
  };
  const removeAt = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= steps.length) return;
    const arr = steps.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const append = () => onChange([...steps, { text: "" }]);

  const onPickImage = async (i: number) => {
    setUploadingIndex(i);
    try {
      // pickImage contract: resolves to a URL on success, null on
      // cancel/permission-denied (no error UI), throws on upload failure.
      const url = await pickImage();
      if (url) updateAt(i, { ...steps[i], image_url: url });
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't add image", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setUploadingIndex(null);
    }
  };

  return (
    <View style={{ marginVertical: spacing.md }}>
      <Text style={typography.headline}>Steps</Text>
      {steps.length === 0 && (
        <Text style={[typography.caption, { opacity: 0.6, marginVertical: spacing.xs }]}>
          No steps yet.
        </Text>
      )}
      {steps.map((step, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            gap: spacing.sm,
            marginVertical: spacing.xs,
            alignItems: "flex-start",
          }}
        >
          <Text style={[typography.body, { width: 24, fontWeight: "600", paddingTop: spacing.sm }]}>
            {i + 1}
          </Text>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <TextInput
              multiline
              placeholder="Describe this step"
              style={[
                typography.body,
                {
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radii.sm,
                  padding: spacing.sm,
                  minHeight: 60,
                },
              ]}
              value={step.text}
              onChangeText={(v) => updateAt(i, { ...step, text: v })}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={typography.caption}>Duration</Text>
              <DurationField
                seconds={step.duration_seconds ?? null}
                onChange={(next) => updateAt(i, { ...step, duration_seconds: next })}
              />
            </View>
            {step.image_url ? (
              <View>
                <Image
                  source={{ uri: resolveImageUrl(step.image_url) ?? step.image_url }}
                  style={{ width: "100%", height: 160, borderRadius: radii.md }}
                  resizeMode="cover"
                />
                <Pressable onPress={() => updateAt(i, { ...step, image_url: null })}>
                  <Text style={[typography.caption, { color: colors.error, marginTop: spacing.xs }]}>
                    Remove image
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Button
                variant="ghost"
                onPress={() => onPickImage(i)}
                title={uploadingIndex === i ? "Uploading…" : "Add image"}
              />
            )}
          </View>
          <View style={{ gap: spacing.xs }}>
            <Pressable onPress={() => swap(i, i - 1)}>
              <Text style={typography.body}>↑</Text>
            </Pressable>
            <Pressable onPress={() => swap(i, i + 1)}>
              <Text style={typography.body}>↓</Text>
            </Pressable>
            <Pressable onPress={() => removeAt(i)}>
              <Text style={[typography.body, { color: colors.error }]}>×</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Button variant="ghost" onPress={append} title="+ Add step" />
    </View>
  );
}
