export const colors = {
  primary: "#9a442d",
  primaryContainer: "#e07a5f",
  primaryFixed: "#ffdbd2",
  onPrimaryFixed: "#7c2e19",
  onPrimary: "#ffffff",

  background: "#faf9f8",
  surface: "#faf9f8",
  surfaceContainerLow: "#f4f3f2",
  surfaceContainer: "#eeeeed",
  surfaceContainerHigh: "#e9e8e7",
  white: "#ffffff",

  onSurface: "#1a1c1c",
  onSurfaceVariant: "#55423e",

  border: "#dbc1ba",
  divider: "#e9e8e7",

  error: "#ba1a1a",
  errorContainer: "#ffdad6",
  onError: "#ffffff",

  successContainer: "#d6f0d8",
  onSuccess: "#1f4d2a",
} as const;

export type ColorToken = keyof typeof colors;
