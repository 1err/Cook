import { spacing as sharedSpacing } from "@cooking/design-tokens";

export const spacing = {
  xs: sharedSpacing["1"],
  sm: sharedSpacing["2"],
  md: sharedSpacing["3"],
  lg: sharedSpacing["4"],
  xl: sharedSpacing["6"],
  "2xl": sharedSpacing["8"],
  "3xl": sharedSpacing["10"],
  "4xl": sharedSpacing["14"],
  "5xl": sharedSpacing["18"],
} as const;

export type SpacingToken = keyof typeof spacing;
