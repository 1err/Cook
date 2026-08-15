import designTokensJson from "./tokens.json";

export const designTokens = designTokensJson;
export const colors = designTokens.color;
export const spacing = designTokens.space;
export const radii = designTokens.radius;
export const typography = designTokens.type;
export const motion = designTokens.motion;
export const elevation = designTokens.elevation;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;
