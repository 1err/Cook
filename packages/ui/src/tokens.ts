export const colors = {
  background: "#faf9f8",
  surface: "#faf9f8",
  surfaceContainer: "#eeeeed",
  surfaceContainerLow: "#f4f3f2",
  surfaceContainerHigh: "#e9e8e7",
  surfaceContainerLowest: "#ffffff",
  onSurface: "#1a1c1c",
  onSurfaceVariant: "#55423e",
  primary: "#9a442d",
  primaryContainer: "#e07a5f",
  onPrimary: "#ffffff",
  secondary: "#5a5c79",
  tertiary: "#006b5b",
  error: "#ba1a1a",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const typography = {
  title: { size: 28, weight: "800" },
  section: { size: 17, weight: "600" },
  body: { size: 15, weight: "400" },
  label: { size: 13, weight: "700" },
} as const;
