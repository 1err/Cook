import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  isSafeWeeeProductUrl,
  type CartAssistantDraft,
  type CartAssistantSelection,
} from "@cooking/shared";
import { Button } from "../../components";
import { colors, radii, spacing, typography } from "../../theme";
import type { MobileCartAssistantDraft } from "./useCartAssistant";

type CartAssistantModalProps = {
  visible: boolean;
  draft: MobileCartAssistantDraft;
  skippedTokens: ReadonlySet<string>;
  onClose: () => void;
  onOpenProduct: (confirmationToken: string, productUrl: string) => Promise<boolean> | boolean;
  onConfirm: (confirmationToken: string) => void;
  onUndoConfirm: (confirmationToken: string) => void;
  onSkip: (confirmationToken: string) => void;
  onFindMatch: (ingredientKey: string) => void;
  onOpenFinalReview: () => Promise<boolean> | boolean;
};

export function getCurrentCartAssistantSelection(
  draft: CartAssistantDraft,
  skippedTokens: ReadonlySet<string>,
): CartAssistantSelection | undefined {
  return draft.selections.find(
    (selection) => (
      !selection.confirmed
      && !skippedTokens.has(selection.confirmationToken)
      && isSafeWeeeProductUrl(selection.product.url)
    ),
  );
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CartAssistantModal({
  visible,
  draft,
  skippedTokens,
  onClose,
  onOpenProduct,
  onConfirm,
  onUndoConfirm,
  onSkip,
  onFindMatch,
  onOpenFinalReview,
}: CartAssistantModalProps) {
  const [attemptedTokens, setAttemptedTokens] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const openGenerationRef = useRef(0);
  const current = useMemo(
    () => getCurrentCartAssistantSelection(draft, skippedTokens),
    [draft, skippedTokens],
  );
  const safeSelectionCount = draft.selections.filter(
    (selection) => isSafeWeeeProductUrl(selection.product.url),
  ).length;
  const hasSkippedSelection = draft.selections.some(
    (selection) => (
      !selection.confirmed
      && skippedTokens.has(selection.confirmationToken)
      && isSafeWeeeProductUrl(selection.product.url)
    ),
  );
  const currentToken = current?.confirmationToken ?? null;
  const currentWasAttempted = currentToken ? attemptedTokens.has(currentToken) : false;
  const empty = draft.selections.length === 0
    && draft.unmatched.length === 0
    && draft.pending.length === 0;

  useEffect(() => {
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    if (!visible) {
      setAttemptedTokens((tokens) => tokens.size ? new Set() : tokens);
    }
    setOpening(false);
    setOpenError(null);
    return () => {
      openGenerationRef.current += 1;
    };
  }, [currentToken, visible]);

  async function openCurrent() {
    if (!current || opening || !isSafeWeeeProductUrl(current.product.url)) return;
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    setAttemptedTokens((tokens) => new Set(tokens).add(current.confirmationToken));
    setOpening(true);
    setOpenError(null);
    try {
      const opened = await onOpenProduct(current.confirmationToken, current.product.url);
      if (openGenerationRef.current === generation && !opened) {
        setOpenError("Couldn't open Weee. Try again from this item.");
      }
    } catch {
      if (openGenerationRef.current === generation) {
        setOpenError("Couldn't open Weee. Try again from this item.");
      }
    } finally {
      if (openGenerationRef.current === generation) setOpening(false);
    }
  }

  async function openFinalReview() {
    if (opening) return;
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    setOpening(true);
    setOpenError(null);
    try {
      const opened = await onOpenFinalReview();
      if (openGenerationRef.current === generation && !opened) {
        setOpenError("Couldn't open Weee. Try again when you're ready.");
      }
    } catch {
      if (openGenerationRef.current === generation) {
        setOpenError("Couldn't open Weee. Try again when you're ready.");
      }
    } finally {
      if (openGenerationRef.current === generation) setOpening(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View
          accessibilityLabel="Review Weee cart"
          accessibilityViewIsModal
          style={styles.sheet}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>CART COMPANION</Text>
              <Text accessibilityRole="header" style={styles.title}>Review Weee cart</Text>
            </View>
            <Pressable
              accessibilityLabel="Close Weee cart review"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View accessibilityLabel="Cart summary" style={styles.summary}>
              <Text style={styles.summaryPrimary}>{draft.summary.readyCount} ready</Text>
              <Text style={styles.summaryText}>{draft.summary.unmatchedCount} unmatched</Text>
              <Text style={styles.summaryText}>
                {draft.summary.confirmedCount} marked as added
              </Text>
              {draft.summary.pendingCount > 0 ? (
                <Text style={styles.summaryText}>
                  {draft.summary.pendingCount} finding matches
                </Text>
              ) : null}
            </View>

            <Text style={styles.estimate}>
              Estimated subtotal: {formatUsd(draft.summary.estimatedSubtotalCents)}
            </Text>
            {draft.summary.unpricedCount > 0 ? (
              <Text style={styles.disclosure}>
                {draft.summary.unpricedCount === 1
                  ? "1 selected item has no price in the listing estimate."
                  : `${draft.summary.unpricedCount} selected items have no price in the listing estimate.`}
              </Text>
            ) : null}

            <View style={styles.selectionList}>
              {draft.selections.map((selection) => {
                const skipped = skippedTokens.has(selection.confirmationToken);
                return (
                  <View key={selection.confirmationToken} style={styles.selectionRow}>
                    <View style={styles.selectionCopy}>
                      <Text style={styles.ingredient}>{selection.ingredientName}</Text>
                      <Text style={styles.requested}>{selection.suggestedPurchase}</Text>
                      <Text style={styles.product}>
                        {selection.product.name} · {selection.product.price || "See listing"}
                      </Text>
                    </View>
                    {selection.confirmed ? (
                      <Button
                        title={`Undo ${selection.ingredientName}`}
                        onPress={() => onUndoConfirm(selection.confirmationToken)}
                        variant="ghost"
                      />
                    ) : skipped ? (
                      <Text style={styles.status}>Skipped</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {current ? (
              <View accessibilityLiveRegion="polite" style={styles.currentCard}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Next: {current.ingredientName}
                </Text>
                <Text style={styles.currentDetail}>
                  {current.suggestedPurchase} · {current.product.name}
                </Text>
                <Button
                  title={currentWasAttempted ? "Open again" : "Open next on Weee"}
                  onPress={() => void openCurrent()}
                  loading={opening}
                  fullWidth
                />
                <View style={styles.secondaryActions}>
                  <Button
                    title="I added it"
                    onPress={() => onConfirm(current.confirmationToken)}
                    variant="secondary"
                    style={styles.actionButton}
                  />
                  <Button
                    title="Skip for now"
                    onPress={() => onSkip(current.confirmationToken)}
                    variant="ghost"
                    style={styles.actionButton}
                  />
                </View>
              </View>
            ) : safeSelectionCount > 0 && draft.pending.length === 0 ? (
              <View accessibilityLiveRegion="polite" style={styles.currentCard}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {hasSkippedSelection ? "Review pass complete" : "Handoff complete"}
                </Text>
                <Text style={styles.currentDetail}>
                  Review your Weee cart for quantity, price, availability, and delivery details.
                </Text>
                <Button
                  title="Open Weee for final review"
                  onPress={() => void openFinalReview()}
                  loading={opening}
                  fullWidth
                />
              </View>
            ) : null}

            {openError ? (
              <Text accessibilityRole="alert" style={styles.error}>{openError}</Text>
            ) : null}

            {draft.unmatched.length > 0 ? (
              <View style={styles.unmatched}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Needs a match</Text>
                {draft.unmatched.map((ingredient) => (
                  <View key={ingredient.key} style={styles.unmatchedRow}>
                    <Text style={styles.unmatchedName}>
                      {ingredient.name} — {ingredient.suggestedPurchase}
                    </Text>
                    <Button
                      title={`Find a match for ${ingredient.name}`}
                      onPress={() => onFindMatch(ingredient.key)}
                      variant="ghost"
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {draft.pending.length > 0 ? (
              <View style={styles.unmatched}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>Finding matches</Text>
                {draft.pending.map((ingredient) => (
                  <View key={ingredient.key} style={styles.pendingRow}>
                    <Text style={styles.unmatchedName}>
                      {ingredient.name} — {ingredient.suggestedPurchase}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {empty ? (
              <View style={styles.emptyState}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  Nothing to review yet
                </Text>
                <Text style={styles.currentDetail}>
                  Load top picks to build a Weee cart draft for this shopping list.
                </Text>
              </View>
            ) : null}

            <Text style={styles.trust}>
              Chef World has not changed your Weee cart. Opening a product never counts as added;
              only your “I added it” confirmation records local progress. Weee confirms final price
              and availability in your session.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(47,38,33,0.42)",
  },
  sheet: {
    maxHeight: "92%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "700",
    letterSpacing: 0.7,
  },
  title: { ...typography.title2, color: colors.ink, marginTop: spacing.xs },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  closeLabel: { ...typography.title2, color: colors.mutedInk },
  content: { gap: spacing.md, padding: spacing.xl, paddingBottom: spacing["3xl"] },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryPrimary: {
    ...typography.subhead,
    color: colors.primary,
    fontWeight: "700",
  },
  summaryText: { ...typography.subhead, color: colors.mutedInk },
  estimate: { ...typography.headline, color: colors.ink },
  disclosure: { ...typography.footnote, color: colors.mutedInk },
  selectionList: { gap: spacing.sm },
  selectionRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.subtleSurface,
  },
  selectionCopy: { flex: 1 },
  ingredient: { ...typography.callout, color: colors.ink, fontWeight: "600" },
  requested: { ...typography.footnote, color: colors.mutedInk, marginTop: 2 },
  product: { ...typography.footnote, color: colors.ink, marginTop: 2 },
  status: { ...typography.footnote, color: colors.mutedInk, fontWeight: "600" },
  currentCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryContainer,
  },
  sectionTitle: { ...typography.headline, color: colors.ink },
  currentDetail: { ...typography.subhead, color: colors.mutedInk },
  secondaryActions: { flexDirection: "row", gap: spacing.sm },
  actionButton: { flex: 1 },
  error: { ...typography.subhead, color: colors.error },
  unmatched: { gap: spacing.sm },
  unmatchedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  pendingRow: {
    minHeight: 44,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  emptyState: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.subtleSurface,
  },
  unmatchedName: { ...typography.subhead, color: colors.ink, flex: 1 },
  trust: {
    ...typography.footnote,
    color: colors.mutedInk,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.subtleSurface,
  },
  pressed: { opacity: 0.85 },
});
