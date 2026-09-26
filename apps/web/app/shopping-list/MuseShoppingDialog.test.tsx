import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CartAssistantDraft } from "@cooking/shared";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { MuseShoppingDialog, type MuseShoppingDialogProps } from "./MuseShoppingDialog";

const draft: CartAssistantDraft = {
  selections: [{
    ingredientKey: "tofu", ingredientName: "Tofu", suggestedPurchase: "600 g",
    product: { name: "Firm tofu 350 g", price: "$2.50", image: "", url: "https://www.sayweee.com/product/tofu" },
    confirmationToken: "tofu-token", confirmed: false,
  }],
  unmatched: [{ key: "ginger", name: "Ginger", suggestedPurchase: "1 knob" }],
  summary: { readyCount: 1, unmatchedCount: 1, confirmedCount: 0, remainingCount: 1, estimatedSubtotalCents: 250, unpricedCount: 0 },
};

function setup(overrides: Partial<MuseShoppingDialogProps> = {}) {
  let props: MuseShoppingDialogProps = {
    open: true, draft, pendingIngredients: [], scopeKey: "account:week-one", onClose: vi.fn(), ...overrides,
  };
  const view = render(<I18nProvider><MuseShoppingDialog {...props} /></I18nProvider>);
  return { ...view, props, update(next: Partial<MuseShoppingDialogProps>) {
    props = { ...props, ...next };
    view.rerender(<I18nProvider><MuseShoppingDialog {...props} /></I18nProvider>);
  } };
}

function enterPacks(value = "2") {
  fireEvent.change(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" }), { target: { value } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("suggests enough packs with the calculation and exports the suggested quantity", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  setup({ pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }] });
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(2);
  expect(screen.getByText("Suggested: 2 packs")).toBeVisible();
  expect(screen.getByText("600 g on your list · 350 g per pack")).toBeVisible();
  expect(screen.getByText(/700 g.*100 g/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  await screen.findByText("Request copied. Open Muse and paste it into your conversation.");
  const request = writeText.mock.calls[0][0] as string;
  expect(request).toContain("https://www.sayweee.com/product/tofu");
  expect(request).toContain("600 g");
  expect(request).toContain("350 g");
  expect(request).toContain('"totalPacksInCart":2');
  expect(request).toContain("Ginger");
  expect(request).toContain("Milk");
  expect(screen.getByRole("link", { name: /Open Muse/ })).toHaveAttribute("href", "https://muse.ai/");
  expect(screen.getByText(/Chef World has not added anything/)).toBeVisible();
});

test("rejects invalid quantities and budgets and prevents stale-list exports", () => {
  const view = setup();
  for (const value of ["0", "1.5", "100", ""]) {
    enterPacks(value);
    expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  }
  enterPacks();
  const budget = screen.getByRole("textbox", { name: /Budget for these products/ });
  fireEvent.change(budget, { target: { value: "-1" } });
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.change(budget, { target: { value: "25.00" } });
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
  view.update({ stale: true });
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  expect(screen.getByText(/Refresh your smart list/)).toBeVisible();
});

test("offers selectable full request when clipboard access fails", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  setup(); enterPacks();
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  await screen.findByRole("alert");
  const request = screen.getByRole("textbox", { name: "Your request for Muse" });
  expect(request).toBeVisible();
  expect(request).toHaveAttribute("readonly");
  expect((request as HTMLTextAreaElement).value).toContain("https://www.sayweee.com/product/tofu");
});

test("does not report a stale asynchronous copy as the current request", async () => {
  let finish!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
  setup(); enterPacks();
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  enterPacks("3");
  await act(async () => { finish(); });
  expect(screen.queryByText("Request copied. Open Muse and paste it into your conversation.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
});

test("retains edits on reopen and recalculates when scope or shopping amounts change", async () => {
  const view = setup(); enterPacks("4");
  view.update({ open: false });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.update({ open: true });
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(4);
  view.update({ scopeKey: "account:week-two" });
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(2);
  enterPacks("4");
  view.update({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "900 g" }] } });
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(3);
  view.update({ draft });
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(2);
});

test("keeps a cleared quantity blank until the customer restores the suggestion", () => {
  const view = setup();
  enterPacks("");
  view.update({ pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }] });
  view.update({ open: false });
  view.update({ open: true });
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(null);
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use suggested quantity for Firm tofu 350 g" }));
  expect(screen.getByRole("spinbutton", { name: "Total packs of Firm tofu 350 g" })).toHaveValue(2);
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
});

test("copies the customer's override instead of silently replacing it with a suggestion", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = setup(); enterPacks("3");
  view.update({ pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }] });
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  await screen.findByText("Request copied. Open Muse and paste it into your conversation.");
  expect(writeText.mock.calls[0][0]).toContain('"totalPacksInCart":3');
  fireEvent.click(screen.getByRole("button", { name: "Use suggested quantity for Firm tofu 350 g" }));
  expect(screen.queryByText("Request copied. Open Muse and paste it into your conversation.")).not.toBeInTheDocument();
});

test("offers one starting pack for missing sizes and incompatible measures, requiring review", () => {
  const view = setup({ draft: { ...draft, selections: [{ ...draft.selections[0], product: { ...draft.selections[0].product, name: "Firm tofu" } }] } });
  expect(screen.getByRole("spinbutton")).toHaveValue(1);
  expect(screen.getByText("Start with 1 pack")).toBeVisible();
  expect(screen.getByText(/Package size isn’t listed/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "I’ve reviewed the estimated and starting quantities." }));
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
  view.update({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "2 cups" }] } });
  expect(screen.getByRole("spinbutton")).toHaveValue(1);
  expect(screen.getByText(/different measurements/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  enterPacks("");
  enterPacks("1");
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
});

test("labels approximate calculations and carries their basis into the reviewed request", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  setup({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "约600 g" }] } });
  expect(screen.getByRole("spinbutton")).toHaveValue(2);
  expect(screen.getByText("Estimated: 2 packs")).toBeVisible();
  expect(screen.queryByText(/Suggested quantity provides/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "I’ve reviewed the estimated and starting quantities." }));
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  await screen.findByText("Request copied. Open Muse and paste it into your conversation.");
  expect(writeText.mock.calls[0][0]).toContain('"quantitySource":"estimated"');
});

test("invalidates starting-quantity review on package edits and preserves an explicitly cleared count", () => {
  const view = setup({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "some" }] } });
  const review = () => screen.getByRole("checkbox", { name: "I’ve reviewed the estimated and starting quantities." });
  fireEvent.click(review());
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Edit package size for Firm tofu 350 g" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Package size for Firm tofu 350 g" }), { target: { value: "500 g" } });
  expect(review()).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  enterPacks("");
  view.update({ open: false }); view.update({ open: true });
  expect(screen.getByRole("spinbutton")).toHaveValue(null);
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use suggested quantity for Firm tofu 350 g" }));
  expect(screen.getByRole("spinbutton")).toHaveValue(1);
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
});

test("keeps review required for other starting counts after manually editing one item", () => {
  setup({ draft: { ...draft, selections: [
    { ...draft.selections[0], suggestedPurchase: "some" },
    { ...draft.selections[0], ingredientKey: "rice", ingredientName: "Rice", suggestedPurchase: "some", product: { ...draft.selections[0].product, name: "Rice bag", url: "https://www.sayweee.com/product/rice" } },
  ] } });
  enterPacks("2");
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Total packs of Rice bag" }), { target: { value: "" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Total packs of Rice bag" }), { target: { value: "1" } });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
});

test("revoking estimate review invalidates a pending copy and changing a request resets review", async () => {
  let finish!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
  setup({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "some" }] } });
  const review = () => screen.getByRole("checkbox", { name: "I’ve reviewed the estimated and starting quantities." });
  fireEvent.click(review());
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  fireEvent.click(review());
  await act(async () => { finish(); });
  expect(screen.queryByText("Request copied. Open Muse and paste it into your conversation.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  fireEvent.click(review());
  const budget = screen.getByRole("textbox", { name: /Budget for these products/ });
  fireEvent.change(budget, { target: { value: "25" } });
  fireEvent.change(budget, { target: { value: "" } });
  expect(review()).not.toBeChecked();
});

test("calculates from a customer supplied package size and includes it in the Muse request", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = setup({ draft: { ...draft, selections: [{ ...draft.selections[0], product: { ...draft.selections[0].product, name: "Firm tofu" } }] } });
  fireEvent.change(screen.getByRole("textbox", { name: "Package size for Firm tofu" }), { target: { value: "350 g" } });
  expect(screen.getByRole("spinbutton")).toHaveValue(2);
  expect(screen.getByText("600 g on your list · 350 g per pack")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Copy for Muse" }));
  await screen.findByText("Request copied. Open Muse and paste it into your conversation.");
  expect(writeText.mock.calls[0][0]).toContain('"reviewedPackageSize":"350 g"');
  view.update({ open: false }); view.update({ open: true });
  expect(screen.getByRole("textbox", { name: "Package size for Firm tofu" })).toHaveValue("350 g");
  fireEvent.change(screen.getByRole("textbox", { name: "Package size for Firm tofu" }), { target: { value: "500 g" } });
  expect(screen.getByText("600 g on your list · 500 g per pack")).toBeVisible();
  expect(screen.queryByText("Request copied. Open Muse and paste it into your conversation.")).not.toBeInTheDocument();
});

test("allows correcting a listed size without overwriting an explicit pack count", () => {
  setup(); enterPacks("4");
  fireEvent.click(screen.getByRole("button", { name: "Edit package size for Firm tofu 350 g" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Package size for Firm tofu 350 g" }), { target: { value: "200 g" } });
  expect(screen.getByRole("spinbutton")).toHaveValue(4);
  expect(screen.getByText("Suggested: 3 packs")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use suggested quantity for Firm tofu 350 g" }));
  expect(screen.getByRole("spinbutton")).toHaveValue(3);
});

test("requires a cart check when a product also serves an ingredient already marked added", () => {
  setup({ draft: { ...draft, selections: [
    { ...draft.selections[0], confirmed: true },
    { ...draft.selections[0], ingredientKey: "more-tofu", suggestedPurchase: "350 g" },
  ] } });
  expect(screen.getByRole("spinbutton")).toHaveValue(null);
  expect(screen.getByText(/Check its current cart quantity/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeDisabled();
  enterPacks("3");
  expect(screen.getByRole("button", { name: "Copy for Muse" })).toBeEnabled();
});

test("closes on Escape and returns focus to the element that opened it", async () => {
  const trigger = document.createElement("button"); trigger.textContent = "Prepare";
  document.body.appendChild(trigger); trigger.focus();
  const view = setup();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(view.props.onClose).toHaveBeenCalledOnce();
  view.update({ open: false });
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
});
