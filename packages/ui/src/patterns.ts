import { colors, radius, spacing } from "./tokens";

export const ButtonPattern = {
  primary: {
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  secondary: {
    backgroundColor: colors.surfaceContainerLow,
    color: colors.onSurface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
} as const;

export const CardPattern = {
  base: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
} as const;

export const InputPattern = {
  base: {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
} as const;

export const TagChipPattern = {
  base: {
    backgroundColor: colors.surfaceContainerLow,
    color: colors.onSurfaceVariant,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
} as const;

export const RecipeCardPattern = {
  mediaRadius: radius.xl,
  bodyPadding: spacing.md,
} as const;

export const IngredientRowPattern = {
  gap: spacing.sm,
  rowPaddingVertical: spacing.sm,
} as const;
