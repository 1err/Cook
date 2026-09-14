import React, { useState } from "react";
import { Pressable } from "react-native";
import { act, fireEvent, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import type { MobileCartAssistantDraft } from "./useCartAssistant";
import { CartAssistantModal } from "./CartAssistantModal";

const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/rice"]);
const kaleToken = JSON.stringify(["kale", "https://www.sayweee.com/product/kale"]);

const draft: MobileCartAssistantDraft = {
  selections: [
    {
      ingredientKey: "rice",
      ingredientName: "Rice",
      suggestedPurchase: "1 bag",
      product: {
        name: "Jasmine rice",
        price: "$2.99",
        image: "",
        url: "https://www.sayweee.com/product/rice",
      },
      confirmationToken: riceToken,
      confirmed: false,
    },
    {
      ingredientKey: "kale",
      ingredientName: "Kale",
      suggestedPurchase: "2 bunches",
      product: {
        name: "Organic kale",
        price: "See listing",
        image: "",
        url: "https://www.sayweee.com/product/kale",
      },
      confirmationToken: kaleToken,
      confirmed: true,
    },
  ],
  unmatched: [{ key: "ginger", name: "Ginger", suggestedPurchase: "1 knob" }],
  pending: [],
  summary: {
    readyCount: 2,
    unmatchedCount: 1,
    confirmedCount: 1,
    remainingCount: 1,
    estimatedSubtotalCents: 299,
    unpricedCount: 1,
    pendingCount: 0,
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function modalProps(
  overrides: Partial<React.ComponentProps<typeof CartAssistantModal>> = {},
): React.ComponentProps<typeof CartAssistantModal> {
  return {
    visible: true,
    draft,
    skippedTokens: new Set(),
    onClose: jest.fn(),
    onOpenProduct: jest.fn().mockResolvedValue(true),
    onConfirm: jest.fn(),
    onUndoConfirm: jest.fn(),
    onSkip: jest.fn(),
    onFindMatch: jest.fn(),
    onOpenFinalReview: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

test("shows summary, estimate disclosure, selected rows, current item, unmatched list, and trust copy", async () => {
  await render(<CartAssistantModal {...modalProps()} />);

  expect(screen.getByText("Review Weee cart")).toBeOnTheScreen();
  expect(screen.getByText("2 ready")).toBeOnTheScreen();
  expect(screen.getByText("1 unmatched")).toBeOnTheScreen();
  expect(screen.getByText("1 marked as added")).toBeOnTheScreen();
  expect(screen.getByText("Estimated subtotal: $2.99")).toBeOnTheScreen();
  expect(screen.getByText("1 selected item has no price in the listing estimate.")).toBeOnTheScreen();
  expect(screen.getByText("Jasmine rice · $2.99")).toBeOnTheScreen();
  expect(screen.getByText("Organic kale · See listing")).toBeOnTheScreen();
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
  expect(screen.getByText("Ginger — 1 knob")).toBeOnTheScreen();
  expect(screen.getByText(/Chef World has not changed your Weee cart/)).toBeOnTheScreen();
});

test("opens only the current product and keeps confirmation as a separate action", async () => {
  const onOpenProduct = jest.fn().mockResolvedValue(true);
  const onConfirm = jest.fn();
  await render(<CartAssistantModal {...modalProps({ onOpenProduct, onConfirm })} />);
  const user = userEvent.setup();

  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));

  await waitFor(() => expect(onOpenProduct).toHaveBeenCalledTimes(1));
  expect(onOpenProduct).toHaveBeenCalledWith(riceToken, "https://www.sayweee.com/product/rice");
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Open again" })).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "I added it" }));
  expect(onConfirm).toHaveBeenCalledWith(riceToken);
});

test("skip advances only session navigation, undo is explicit, and closing resets skipped progress", async () => {
  const onUndoConfirm = jest.fn();
  const onClose = jest.fn();

  function Harness() {
    const [visible, setVisible] = useState(true);
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    return (
      <>
        <CartAssistantModal
          {...modalProps({
            visible,
            skippedTokens: skipped,
            onClose: () => {
              setVisible(false);
              setSkipped(new Set());
              onClose();
            },
            onSkip: (token) => setSkipped((current) => new Set(current).add(token)),
            onUndoConfirm,
          })}
        />
        {!visible ? (
          <Pressable
            accessibilityLabel="Reopen"
            accessibilityRole="button"
            onPress={() => {
              setSkipped(new Set());
              setVisible(true);
            }}
          />
        ) : null}
      </>
    );
  }

  const rendered = await render(<Harness />);
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Skip for now" }));
  expect(screen.getByText("Review pass complete")).toBeOnTheScreen();
  expect(screen.queryByText("Handoff complete")).not.toBeOnTheScreen();
  expect(screen.getByText("1 marked as added")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Undo Kale" }));
  expect(onUndoConfirm).toHaveBeenCalledWith(kaleToken);

  const nativeModal = rendered.container.queryAll(
    (instance) => instance.props.presentationStyle === "overFullScreen",
  )[0];
  expect(nativeModal).toBeDefined();
  fireEvent(nativeModal, "requestClose");
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.press(await screen.findByRole("button", { name: "Reopen" }));
  expect(screen.getByText("Next: Rice")).toBeOnTheScreen();
});

test("reports a failed handoff without confirming and never offers an unsafe URL", async () => {
  const onConfirm = jest.fn();
  const onOpenProduct = jest.fn().mockResolvedValue(false);
  const rendered = await render(
    <CartAssistantModal {...modalProps({ onConfirm, onOpenProduct })} />,
  );
  const user = userEvent.setup();

  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't open Weee. Try again from this item.",
  );
  expect(onConfirm).not.toHaveBeenCalled();

  const unsafeDraft: MobileCartAssistantDraft = {
    ...draft,
    selections: [{
      ...draft.selections[0],
      product: {
        ...draft.selections[0].product,
        url: "https://sayweee.com.evil.test/product/rice",
      },
      confirmationToken: "unsafe-token",
    }],
    summary: { ...draft.summary, readyCount: 1, confirmedCount: 0, remainingCount: 1 },
  };
  await rendered.rerender(<CartAssistantModal {...modalProps({ draft: unsafeDraft })} />);

  expect(screen.queryByRole("button", { name: /Open (next|again)/ })).not.toBeOnTheScreen();
});

test("ignores a late open failure after the review closes and reopens", async () => {
  const pending = deferred<boolean>();
  const rendered = await render(
    <CartAssistantModal
      {...modalProps({ onOpenProduct: jest.fn().mockReturnValue(pending.promise) })}
    />,
  );
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));

  await rendered.rerender(<CartAssistantModal {...modalProps({ visible: false })} />);
  await rendered.rerender(<CartAssistantModal {...modalProps({ visible: true })} />);
  await act(async () => {
    pending.resolve(false);
    await pending.promise;
  });

  expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
});

test("ignores a late open failure when the current item advances", async () => {
  const pending = deferred<boolean>();
  const allPending: MobileCartAssistantDraft = {
    ...draft,
    selections: draft.selections.map((selection) => ({ ...selection, confirmed: false })),
    summary: { ...draft.summary, confirmedCount: 0, remainingCount: 2 },
  };
  const rendered = await render(
    <CartAssistantModal
      {...modalProps({
        draft: allPending,
        onOpenProduct: jest.fn().mockReturnValue(pending.promise),
      })}
    />,
  );
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));

  const advanced: MobileCartAssistantDraft = {
    ...allPending,
    selections: allPending.selections.map((selection) => ({
      ...selection,
      confirmed: selection.confirmationToken === riceToken,
    })),
    summary: { ...allPending.summary, confirmedCount: 1, remainingCount: 1 },
  };
  await rendered.rerender(<CartAssistantModal {...modalProps({ draft: advanced })} />);
  expect(screen.getByText("Next: Kale")).toBeOnTheScreen();
  await act(async () => {
    pending.resolve(false);
    await pending.promise;
  });

  expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
  expect(screen.getByText("Next: Kale")).toBeOnTheScreen();
});

test("invalidates a rejected opener on unmount", async () => {
  const pending = deferred<boolean>();
  const rendered = await render(
    <CartAssistantModal
      {...modalProps({ onOpenProduct: jest.fn().mockReturnValue(pending.promise) })}
    />,
  );
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Open next on Weee" }));
  await act(async () => {
    rendered.unmount();
    await Promise.resolve();
  });

  await act(async () => {
    pending.reject(new Error("late rejection"));
    await expect(pending.promise).rejects.toThrow("late rejection");
  });
});

test("shows pending matches separately without a find-match action", async () => {
  const pendingDraft: MobileCartAssistantDraft = {
    ...draft,
    pending: [{ key: "tofu", name: "Tofu", suggestedPurchase: "2 blocks" }],
    summary: { ...draft.summary, pendingCount: 1 },
  };
  await render(<CartAssistantModal {...modalProps({ draft: pendingDraft })} />);

  expect(screen.getByText("1 finding matches")).toBeOnTheScreen();
  expect(screen.getByText("Finding matches")).toBeOnTheScreen();
  expect(screen.getByText("Tofu — 2 blocks")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Find a match for Tofu" })).not.toBeOnTheScreen();
});

test("shows an explicit empty state when every review row disappears", async () => {
  const emptyDraft: MobileCartAssistantDraft = {
    selections: [],
    unmatched: [],
    pending: [],
    summary: {
      readyCount: 0,
      unmatchedCount: 0,
      confirmedCount: 0,
      remainingCount: 0,
      estimatedSubtotalCents: 0,
      unpricedCount: 0,
      pendingCount: 0,
    },
  };
  await render(<CartAssistantModal {...modalProps({ draft: emptyDraft })} />);

  expect(screen.getByText("Nothing to review yet")).toBeOnTheScreen();
  expect(screen.getByText(/Load top picks to build a Weee cart draft/)).toBeOnTheScreen();
});

test("routes native request-close and exposes modal accessibility containment", async () => {
  const onClose = jest.fn();
  const rendered = await render(<CartAssistantModal {...modalProps({ onClose })} />);

  expect(screen.getByLabelText("Review Weee cart")).toHaveProp("accessibilityViewIsModal", true);
  const nativeModal = rendered.container.queryAll(
    (instance) => instance.props.onRequestClose === onClose,
  )[0];
  expect(nativeModal).toBeDefined();
  fireEvent(nativeModal, "requestClose");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("offers final Weee review only after every safe selection is handled", async () => {
  const completed: MobileCartAssistantDraft = {
    ...draft,
    selections: draft.selections.map((selection) => ({ ...selection, confirmed: true })),
    summary: { ...draft.summary, confirmedCount: 2, remainingCount: 0 },
  };
  const completedWithPending: MobileCartAssistantDraft = {
    ...completed,
    pending: [{ key: "tofu", name: "Tofu", suggestedPurchase: "2 blocks" }],
    summary: { ...completed.summary, pendingCount: 1 },
  };
  const onOpenFinalReview = jest.fn().mockResolvedValue(true);
  const rendered = await render(
    <CartAssistantModal {...modalProps({ draft: completedWithPending, onOpenFinalReview })} />,
  );
  const user = userEvent.setup();

  expect(screen.queryByText("Handoff complete")).not.toBeOnTheScreen();
  expect(screen.getByText("Finding matches")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Open Weee for final review" })).not.toBeOnTheScreen();

  await rendered.rerender(
    <CartAssistantModal {...modalProps({ draft: completed, onOpenFinalReview })} />,
  );
  expect(screen.getByText("Handoff complete")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Open Weee for final review" }));
  expect(onOpenFinalReview).toHaveBeenCalledTimes(1);
});
