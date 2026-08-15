import { radii as sharedRadii } from "@cooking/design-tokens";

export const radii = {
  sm: sharedRadii.control,
  md: sharedRadii.field,
  lg: sharedRadii.card,
  xl: sharedRadii.modal,
  full: sharedRadii.round,
} as const;

export type RadiusToken = keyof typeof radii;
