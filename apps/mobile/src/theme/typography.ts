import type { TextStyle } from "react-native";

export const typography = {
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.37 },
  title1: { fontSize: 28, fontWeight: "700", letterSpacing: 0.36 },
  recipeTitle: { fontSize: 28, fontWeight: "700", letterSpacing: 0.36, fontFamily: "Georgia" },
  title2: { fontSize: 22, fontWeight: "700" },
  title3: { fontSize: 20, fontWeight: "600" },
  headline: { fontSize: 17, fontWeight: "600" },
  body: { fontSize: 17, fontWeight: "400" },
  callout: { fontSize: 16, fontWeight: "400" },
  subhead: { fontSize: 15, fontWeight: "400" },
  footnote: { fontSize: 13, fontWeight: "400" },
  caption: { fontSize: 12, fontWeight: "400" },
} satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
