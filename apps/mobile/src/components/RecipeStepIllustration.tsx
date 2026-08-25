import React, { useEffect, useState } from "react";
import { StyleSheet, View, type ImageStyle, type StyleProp } from "react-native";
import { Image } from "expo-image";
import Svg, { Circle, Line, Path } from "react-native-svg";
import {
  getRecipeActionIllustration,
  RECIPE_ACTION_ILLUSTRATION_VIEW_BOX,
  type RecipeActionType,
  type RecipeStep,
  type RecipeVectorPaletteRole,
} from "@cooking/shared";
import { resolveImageUrl } from "../lib/imageUrl";
import { colors, radii } from "../theme";

type RecipeStepIllustrationProps = {
  actionType: RecipeActionType | null | undefined;
  title: string;
  size?: number;
};

const palette: Record<RecipeVectorPaletteRole, string> = {
  accent: colors.terracotta,
  ink: colors.ink,
  surface: colors.subtleSurface,
};

export function RecipeStepIllustration({
  actionType,
  title,
  size = 88,
}: RecipeStepIllustrationProps) {
  const primitives = getRecipeActionIllustration(actionType);
  return (
    <View style={[styles.illustration, { width: size, height: size }]}>
      <Svg
        accessible
        accessibilityLabel={title}
        accessibilityRole="image"
        height={size}
        viewBox={RECIPE_ACTION_ILLUSTRATION_VIEW_BOX}
        width={size}
      >
        {primitives.map((primitive, index) => {
          if (primitive.kind === "path") {
            return (
              <Path
                key={`path-${index}`}
                d={primitive.d}
                fill={primitive.fill ? palette[primitive.fill] : "none"}
                stroke={colors.ink}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
              />
            );
          }
          if (primitive.kind === "circle") {
            return (
              <Circle
                key={`circle-${index}`}
                cx={primitive.cx}
                cy={primitive.cy}
                fill={primitive.fill ? palette[primitive.fill] : colors.surface}
                r={primitive.r}
                stroke={colors.ink}
                strokeWidth={1.8}
              />
            );
          }
          return (
            <Line
              key={`line-${index}`}
              stroke={colors.ink}
              strokeLinecap="round"
              strokeWidth={2}
              x1={primitive.x1}
              x2={primitive.x2}
              y1={primitive.y1}
              y2={primitive.y2}
            />
          );
        })}
      </Svg>
    </View>
  );
}

type RecipeStepVisualProps = {
  step: RecipeStep;
  imageTitle: string;
  illustrationTitle: string;
  size?: number;
  imageStyle?: StyleProp<ImageStyle>;
};

export function RecipeStepVisual({
  step,
  imageTitle,
  illustrationTitle,
  size,
  imageStyle,
}: RecipeStepVisualProps) {
  const resolvedImageUrl = resolveImageUrl(step.image_url);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedImageUrl]);

  if (resolvedImageUrl && !imageFailed) {
    return (
      <Image
        accessible
        accessibilityLabel={imageTitle}
        accessibilityRole="image"
        contentFit="cover"
        onError={() => setImageFailed(true)}
        source={{ uri: resolvedImageUrl }}
        style={[styles.image, imageStyle]}
        transition={200}
      />
    );
  }

  return (
    <RecipeStepIllustration
      actionType={step.action_type}
      size={size}
      title={illustrationTitle}
    />
  );
}

const styles = StyleSheet.create({
  illustration: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  image: {
    width: "100%",
    height: 220,
    borderRadius: radii.md,
  },
});
