import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { RecipeStep } from "@cooking/shared";
import { RecipeStepIllustration, RecipeStepVisual } from "./RecipeStepIllustration";

function countHostType(node: unknown, type: string): number {
  if (Array.isArray(node)) return node.reduce((count, child) => count + countHostType(child, type), 0);
  if (!node || typeof node !== "object") return 0;
  const element = node as { type?: string; children?: unknown[] };
  return (element.type === type ? 1 : 0) + countHostType(element.children ?? [], type);
}

const step: RecipeStep = {
  id: "a9b687b2-3777-42cc-b7c4-77dc672e87e8",
  text: "Mix the sauce.",
  duration_seconds: 120,
  duration_source: "stated",
  attention_type: "hands_on",
  action_type: "mix",
  image_url: "https://example.com/step.jpg",
};

test("renders shared vector primitives through native Svg elements", async () => {
  const view = await render(
    <RecipeStepIllustration actionType="mix" title="Mix illustration" />,
  );

  expect(screen.getByRole("image", { name: "Mix illustration" })).toBeOnTheScreen();
  const tree = view.toJSON();
  expect(countHostType(tree, "RNSVGSvgView")).toBe(1);
  expect(countHostType(tree, "RNSVGPath")).toBeGreaterThan(0);
  expect(countHostType(tree, "RNSVGCircle")).toBeGreaterThan(0);
  expect(countHostType(tree, "RNSVGLine")).toBeGreaterThan(0);
});

test("accepts localized accessible illustration labels without embedding text in the art", async () => {
  await render(<RecipeStepIllustration actionType="simmer" title="炖煮插图" />);

  expect(screen.getByRole("image", { name: "炖煮插图" })).toBeOnTheScreen();
  expect(screen.queryByText("炖煮插图")).not.toBeOnTheScreen();
});

test("uses a real step image first and falls back to the action illustration after failure", async () => {
  await render(
    <RecipeStepVisual
      step={step}
      imageTitle="Step 1 image"
      illustrationTitle="Mix illustration"
    />,
  );

  const image = screen.getByRole("image", { name: "Step 1 image" });
  expect(screen.queryByRole("image", { name: "Mix illustration" })).not.toBeOnTheScreen();

  await fireEvent(image, "error", { nativeEvent: { error: "failed" } });

  expect(screen.queryByRole("image", { name: "Step 1 image" })).not.toBeOnTheScreen();
  expect(screen.getByRole("image", { name: "Mix illustration" })).toBeOnTheScreen();
});
