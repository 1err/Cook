import type { TextStyle } from "react-native";

export const typography = {
  largeTitle: { fontSize: 34, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.2 },
  title1: { fontSize: 28, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.1 },
  recipeTitle: { fontSize: 28, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.1 },
  title2: { fontSize: 22, fontFamily: "SourceSerif4_600SemiBold" },
  title3: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  headline: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 17, fontFamily: "Inter_400Regular" },
  callout: { fontSize: 16, fontFamily: "Inter_400Regular" },
  subhead: { fontSize: 15, fontFamily: "Inter_400Regular" },
  footnote: { fontSize: 13, fontFamily: "Inter_400Regular" },
  caption: { fontSize: 12, fontFamily: "Inter_400Regular" },
} satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
