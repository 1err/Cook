import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartAssistantDraft } from "@cooking/shared";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { CartAssistantDialog } from "./CartAssistantDialog";

const riceToken = JSON.stringify(["rice", "https://www.sayweee.com/product/rice"]);
const kaleToken = JSON.stringify(["kale", "https://www.sayweee.com/product/kale"]);

const draft: CartAssistantDraft = {
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
  summary: {
    readyCount: 2,
    unmatchedCount: 1,
    confirmedCount: 1,
    remainingCount: 1,
    estimatedSubtotalCents: 299,
    unpricedCount: 1,
  },
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof CartAssistantDialog>> = {}) {
  const props: React.ComponentProps<typeof CartAssistantDialog> = {
    open: true,
    draft,
    pendingIngredients: [],
    skippedTokens: new Set(),
    onClose: vi.fn(),
    onOpenProduct: vi.fn(),
    onConfirm: vi.fn(),
    onUndoConfirm: vi.fn(),
    onSkip: vi.fn(),
    onFindMatch: vi.fn(),
    ...overrides,
  };

  const rendered = render(
    <I18nProvider>
      <CartAssistantDialog {...props} />
    </I18nProvider>,
  );
  return {
    props,
    rerender: (next: Partial<React.ComponentProps<typeof CartAssistantDialog>>) => {
      rendered.rerender(
        <I18nProvider>
          <CartAssistantDialog {...props} {...next} />
        </I18nProvider>,
      );
    },
  };
}

afterEach(() => {
  cleanup();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("shows pending matches separately from settled unmatched items", () => {
  renderDialog({
    pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }],
  });

  expect(screen.getByRole("dialog", { name: "Review Weee cart" })).toHaveAttribute("aria-modal", "true");
  expect(screen.getByText("2 ready")).toBeVisible();
  expect(screen.getByText("1 unmatched")).toBeVisible();
  expect(screen.getByText("1 finding a match")).toBeVisible();
  expect(screen.getByText("1 marked as added")).toBeVisible();
  expect(screen.getByText("Estimated subtotal: $2.99")).toBeVisible();
  expect(screen.getByText("1 selected item has no price in the listing estimate.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Next: Rice" })).toBeVisible();
  expect(screen.getByText(/Jasmine rice · \$2\.99/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Needs a match" })).toBeVisible();
  expect(screen.getByText("Ginger — 1 knob")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Finding matches" })).toBeVisible();
  expect(screen.getByText("Milk — 1 carton")).toBeVisible();
  expect(screen.getByText(/Chef World has not changed your Weee cart/)).toBeVisible();
});

test("opening a product calls only the open callback once and offers popup recovery", async () => {
  const user = userEvent.setup();
  const onOpenProduct = vi.fn();
  const onConfirm = vi.fn();
  const rendered = renderDialog({ onOpenProduct, onConfirm });

  const directLink = screen.getByRole("link", { name: "Open Jasmine rice directly on Weee" });
  expect(directLink).toHaveAttribute("href", "https://www.sayweee.com/product/rice");
  expect(directLink).toHaveAttribute("target", "_blank");
  expect(directLink).toHaveAttribute("rel", "noopener noreferrer");

  await user.click(screen.getByRole("button", { name: "Open next on Weee" }));

  expect(onOpenProduct).toHaveBeenCalledTimes(1);
  expect(onOpenProduct).toHaveBeenCalledWith("https://www.sayweee.com/product/rice");
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Open again" })).toBeVisible();

  rendered.rerender({ open: false });
  rendered.rerender({ open: true });
  expect(screen.getByRole("button", { name: "Open next on Weee" })).toBeVisible();
});

test("confirm, skip, undo, and find-match require their explicit user actions", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onUndoConfirm = vi.fn();
  const onSkip = vi.fn();
  const onFindMatch = vi.fn();
  renderDialog({ onConfirm, onUndoConfirm, onSkip, onFindMatch });

  await user.click(screen.getByRole("button", { name: "I added it" }));
  await user.click(screen.getByRole("button", { name: "Skip for now" }));
  await user.click(screen.getByRole("button", { name: "Undo Kale" }));
  await user.click(screen.getByRole("button", { name: "Find a match for Ginger" }));

  expect(onConfirm).toHaveBeenCalledWith(riceToken);
  expect(onSkip).toHaveBeenCalledWith(riceToken);
  expect(onUndoConfirm).toHaveBeenCalledWith(kaleToken);
  expect(onFindMatch).toHaveBeenCalledWith("ginger");
});

test("closes on Escape and stays absent while closed", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const rendered = renderDialog({ onClose });

  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);

  cleanup();
  render(
    <I18nProvider>
      <CartAssistantDialog {...rendered.props} open={false} />
    </I18nProvider>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("uses the native modal API and routes cancel through onClose", () => {
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal,
  });
  const onClose = vi.fn();
  renderDialog({ onClose });

  const dialog = screen.getByRole("dialog", { name: "Review Weee cart" });
  expect(showModal).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Close Weee cart review" })).toHaveFocus();

  const cancelEvent = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancelEvent);
  expect(cancelEvent.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("advances after confirm or skip and shows completion after every selection is handled", () => {
  const allPending: CartAssistantDraft = {
    ...draft,
    selections: draft.selections.map((selection) => ({ ...selection, confirmed: false })),
    summary: { ...draft.summary, confirmedCount: 0, remainingCount: 2 },
  };
  const rendered = renderDialog({ draft: allPending });
  expect(screen.getByRole("heading", { name: "Next: Rice" })).toBeVisible();

  rendered.rerender({
    draft: {
      ...allPending,
      selections: allPending.selections.map((selection) => ({
        ...selection,
        confirmed: selection.confirmationToken === riceToken,
      })),
      summary: { ...allPending.summary, confirmedCount: 1, remainingCount: 1 },
    },
  });
  expect(screen.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  rendered.rerender({ draft: allPending, skippedTokens: new Set([riceToken]) });
  expect(screen.getByRole("heading", { name: "Next: Kale" })).toBeVisible();

  rendered.rerender({
    draft: allPending,
    pendingIngredients: [],
    skippedTokens: new Set([riceToken, kaleToken]),
  });
  expect(screen.getByRole("heading", { name: "Review pass complete" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Handoff complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Weee for final review" })).toBeVisible();

  rendered.rerender({
    draft: {
      ...allPending,
      selections: allPending.selections.map((selection) => ({ ...selection, confirmed: true })),
      summary: { ...allPending.summary, confirmedCount: 2, remainingCount: 0 },
    },
    pendingIngredients: [{ key: "tofu", name: "Tofu", suggestedPurchase: "2 blocks" }],
    skippedTokens: new Set(),
  });
  expect(screen.queryByRole("heading", { name: "Handoff complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Finding matches" })).toBeVisible();

  rendered.rerender({
    draft: {
      ...allPending,
      selections: allPending.selections.map((selection) => ({ ...selection, confirmed: true })),
      summary: { ...allPending.summary, confirmedCount: 2, remainingCount: 0 },
    },
    pendingIngredients: [],
    skippedTokens: new Set(),
  });
  expect(screen.getByRole("heading", { name: "Handoff complete" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Open Weee for final review" })).toBeVisible();
});

test("never renders a direct product anchor for an unsafe URL", () => {
  const unsafeDraft: CartAssistantDraft = {
    ...draft,
    selections: [
      {
        ...draft.selections[0],
        product: { ...draft.selections[0].product, url: "https://sayweee.com.evil.test/product/rice" },
        confirmationToken: JSON.stringify(["rice", "https://sayweee.com.evil.test/product/rice"]),
      },
    ],
    summary: { ...draft.summary, readyCount: 1, confirmedCount: 0, remainingCount: 1 },
  };
  renderDialog({ draft: unsafeDraft });

  expect(screen.queryByRole("link", { name: /directly on Weee/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Open (next|again)/ })).not.toBeInTheDocument();
});
