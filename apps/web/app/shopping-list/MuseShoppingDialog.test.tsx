import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CartAssistantDraft } from "@cooking/shared";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { MuseShoppingDialog, type MuseShoppingDialogProps } from "./MuseShoppingDialog";

const productName = "Firm tofu 350 g";
const copiedMessage = "Copied. Open Muse and paste your request.";
const draft: CartAssistantDraft = {
  selections: [{
    ingredientKey: "tofu", ingredientName: "Tofu", suggestedPurchase: "600 g",
    product: { name: productName, price: "$2.50", image: "", url: "https://www.sayweee.com/product/tofu" },
    confirmationToken: "tofu-token", confirmed: false,
  }],
  unmatched: [{ key: "ginger", name: "Ginger", suggestedPurchase: "1 knob" }],
  summary: { readyCount: 1, unmatchedCount: 1, confirmedCount: 0, remainingCount: 1, estimatedSubtotalCents: 250, unpricedCount: 0 },
};

function setup(overrides: Partial<MuseShoppingDialogProps> = {}) {
  let props: MuseShoppingDialogProps = {
    open: true, draft, pendingIngredients: [], scopeKey: "account:week-one", onClose: vi.fn(),
    onRefresh: vi.fn(), refreshing: false, refreshError: null, ...overrides,
  };
  const view = render(<I18nProvider><MuseShoppingDialog {...props} /></I18nProvider>);
  return { ...view, props, update(next: Partial<MuseShoppingDialogProps>) {
    props = { ...props, ...next };
    view.rerender(<I18nProvider><MuseShoppingDialog {...props} /></I18nProvider>);
  } };
}

function packs(name = productName) {
  return screen.getByRole("spinbutton", { name: `Total packs of ${name}` });
}
function enterPacks(value: string, name = productName) {
  fireEvent.change(packs(name), { target: { value } });
}
function confirmButton() {
  return screen.getByRole("button", { name: "Confirm quantities & copy" });
}
function openDetails(name = productName) {
  const summary = screen.getByLabelText(`Details for ${name}`);
  if (!summary.closest("details")?.open) fireEvent.click(summary);
  return summary.closest("details")!;
}
function openPreferences() {
  const summary = screen.getByLabelText("Shopping preferences");
  if (!summary.closest("details")?.open) fireEvent.click(summary);
  return summary;
}
function clipboardSuccess() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
}
function requestProducts(request: string) {
  return JSON.parse(request.split("SHOPPING_DATA_JSON = ")[1]).products as Array<{
    productName: string; totalPacksInCart: number; quantitySource: string; reviewedPackageSize?: string;
  }>;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("confirms and copies the displayed counts in one click before offering the request export", async () => {
  const writeText = clipboardSuccess();
  setup({ pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }] });
  expect(packs()).toHaveValue(2);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save request as text", hidden: true })).not.toBeInTheDocument();
  expect(confirmButton()).toBeEnabled();
  fireEvent.click(confirmButton());
  // Clipboard writing must happen in the click, not after a state-change effect.
  expect(writeText).toHaveBeenCalledTimes(1);
  await screen.findByText(copiedMessage);
  const request = writeText.mock.calls[0][0] as string;
  expect(requestProducts(request)).toMatchObject([{ productName, totalPacksInCart: 2, quantitySource: "calculated" }]);
  expect(request).toContain("https://www.sayweee.com/product/tofu");
  expect(request).toContain("Ginger");
  expect(request).toContain("Milk");
  expect(screen.getByRole("link", { name: "Open Muse" })).toHaveAttribute("href", "https://muse.ai/");
  expect(screen.getByRole("button", { name: "Copy again" })).toBeEnabled();
  expect(screen.getByLabelText("Your request for Muse")).toHaveValue(request);
  fireEvent.click(screen.getByRole("button", { name: "Copy again" }));
  expect(writeText).toHaveBeenCalledTimes(2);
});

test("keeps calculations and optional preferences collapsed until requested", () => {
  setup();
  const details = screen.getByLabelText(`Details for ${productName}`).closest("details")!;
  expect(details).not.toHaveAttribute("open");
  expect(screen.getByLabelText("Shopping preferences").closest("details")).not.toHaveAttribute("open");
  openDetails();
  expect(screen.getByText("600 g on your list · 350 g per pack")).toBeVisible();
  expect(screen.getByText(/700 g.*100 g/)).toBeVisible();
  expect(screen.getByRole("textbox", { name: `Package size for ${productName}` })).toBeVisible();
});

test.each([
  ["约600 g", "Firm tofu 350 g", 2, "estimated"],
  ["600 g", "Firm tofu", 1, "starting"],
  ["2 cups", "Firm tofu 350 g", 1, "starting"],
])("confirms %s against %s without a separate checkbox", async (amount, name, count, source) => {
  const writeText = clipboardSuccess();
  setup({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: amount as string,
    product: { ...draft.selections[0].product, name: name as string } }] } });
  expect(packs(name as string)).toHaveValue(count);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  fireEvent.click(confirmButton());
  expect(writeText).toHaveBeenCalledTimes(1);
  await screen.findByText(copiedMessage);
  expect(requestProducts(writeText.mock.calls[0][0])).toMatchObject([{ totalPacksInCart: count, quantitySource: source }]);
});

test("fix quantities focuses the invalid count without exporting a request", () => {
  const writeText = clipboardSuccess();
  setup();
  for (const value of ["0", "1.5", "100", ""]) {
    enterPacks(value);
    const fix = screen.getByRole("button", { name: "Fix quantities" });
    expect(fix).toBeEnabled();
    fireEvent.click(fix);
    expect(packs()).toHaveFocus();
    expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  }
  expect(writeText).not.toHaveBeenCalled();
  enterPacks("2");
  expect(confirmButton()).toBeEnabled();
});

test("fix quantities goes to the first invalid row rather than a valid preceding product", () => {
  const writeText = clipboardSuccess();
  setup({ draft: { ...draft, selections: [...draft.selections, {
    ...draft.selections[0], ingredientKey: "rice", ingredientName: "Rice", confirmationToken: "rice-token",
    product: { ...draft.selections[0].product, name: "Rice bag", url: "https://www.sayweee.com/product/rice" },
  }] } });
  enterPacks("", "Rice bag");
  fireEvent.click(screen.getByRole("button", { name: "Fix quantities" }));
  expect(packs("Rice bag")).toHaveFocus();
  expect(writeText).not.toHaveBeenCalled();
});

test("fix budget opens preferences and focuses the invalid budget without copying", () => {
  const writeText = clipboardSuccess();
  setup();
  const summary = openPreferences();
  const budget = screen.getByRole("textbox", { name: /Budget for these products/ });
  fireEvent.change(budget, { target: { value: "-1" } });
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "Fix budget" }));
  expect(budget).toBeVisible();
  expect(budget).toHaveFocus();
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.change(budget, { target: { value: "25.00" } });
  expect(confirmButton()).toBeEnabled();
});

test("updates a stale list and exposes retryable refresh errors without exporting", () => {
  const writeText = clipboardSuccess();
  const onRefresh = vi.fn();
  const view = setup({ stale: true, onRefresh });
  expect(screen.queryByRole("button", { name: "Confirm quantities & copy" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Update shopping list" }));
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(writeText).not.toHaveBeenCalled();
  view.update({ refreshing: true });
  expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
  expect(screen.getByRole("dialog")).toBeVisible();
  view.update({ refreshing: false, refreshError: "Could not refresh your current planner list" });
  expect(screen.getByText("Could not refresh your current planner list")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Update shopping list" }));
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(writeText).not.toHaveBeenCalled();
  view.update({ stale: false, refreshError: null });
  expect(confirmButton()).toBeEnabled();
});

test("refreshing independently blocks copying even if stale has already cleared", () => {
  const writeText = clipboardSuccess();
  setup({ stale: false, refreshing: true });
  expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(writeText).not.toHaveBeenCalled();
});

test("offers the confirmed request for selection and download when clipboard access fails", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  setup({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "some" }] } });
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  fireEvent.click(confirmButton());
  const request = await screen.findByRole("textbox", { name: "Your request for Muse" });
  expect(request).toBeVisible();
  expect(request).toHaveAttribute("readonly");
  await waitFor(() => expect(request).toHaveFocus());
  expect((request as HTMLTextAreaElement).selectionEnd).toBe((request as HTMLTextAreaElement).value.length);
  expect(requestProducts((request as HTMLTextAreaElement).value)).toMatchObject([{ totalPacksInCart: 1, quantitySource: "starting" }]);
  expect(screen.getByRole("button", { name: "Save request as text" })).toBeVisible();
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
});

test("does not report a pending copy after the quantity changes", async () => {
  let finish!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) } });
  setup();
  fireEvent.click(confirmButton());
  enterPacks("3");
  await act(async () => { finish(); });
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(confirmButton()).toBeEnabled();
});

test("does not resurrect pending-copy confirmation after an edit is reverted", async () => {
  let finish!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) } });
  setup({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "some" }] } });
  fireEvent.click(confirmButton());
  openPreferences();
  const budget = screen.getByRole("textbox", { name: /Budget for these products/ });
  fireEvent.change(budget, { target: { value: "25" } });
  fireEvent.change(budget, { target: { value: "" } });
  await act(async () => { finish(); });
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(confirmButton()).toBeEnabled();
});

test.each(["stale", "refreshing"] as const)("invalidates a pending request when the list becomes %s", async (state) => {
  let finish!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) } });
  const view = setup();
  fireEvent.click(confirmButton());
  view.update({ [state]: true });
  await act(async () => { finish(); });
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Copy again" })).not.toBeInTheDocument();
});

test("ignores a pending clipboard result after closing and reopening the review", async () => {
  let finish!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) } });
  const view = setup();
  fireEvent.click(confirmButton());
  view.update({ open: false });
  view.update({ open: true });
  await act(async () => { finish(); });
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(confirmButton()).toBeEnabled();
});

test("ignores a rejected clipboard operation from an unmounted review", async () => {
  let reject!: (reason: Error) => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; })) } });
  const oldView = setup();
  fireEvent.click(confirmButton());
  oldView.unmount();
  setup({ scopeKey: "different-account:week-one" });
  await act(async () => { reject(new Error("clipboard denied after unmount")); });
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("retains edits on reopen and recalculates when scope or shopping amounts change", () => {
  const view = setup(); enterPacks("4");
  view.update({ open: false });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.update({ open: true });
  expect(packs()).toHaveValue(4);
  view.update({ scopeKey: "account:week-two" });
  expect(packs()).toHaveValue(2);
  enterPacks("4");
  view.update({ draft: { ...draft, selections: [{ ...draft.selections[0], suggestedPurchase: "900 g" }] } });
  expect(packs()).toHaveValue(3);
  view.update({ draft });
  expect(packs()).toHaveValue(2);
});

test("keeps a cleared quantity blank until the customer restores its suggestion", () => {
  const view = setup();
  enterPacks("");
  view.update({ pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }] });
  view.update({ open: false }); view.update({ open: true });
  expect(packs()).toHaveValue(null);
  expect(screen.getByRole("button", { name: "Fix quantities" })).toBeEnabled();
  openDetails();
  fireEvent.click(screen.getByRole("button", { name: `Use suggested quantity for ${productName}` }));
  expect(packs()).toHaveValue(2);
  expect(confirmButton()).toBeEnabled();
});

test("copies a manual override without replacing it when unrelated matches change", async () => {
  const writeText = clipboardSuccess();
  const view = setup(); enterPacks("3");
  view.update({ pendingIngredients: [{ key: "milk", name: "Milk", suggestedPurchase: "1 carton" }] });
  fireEvent.click(confirmButton());
  await screen.findByText(copiedMessage);
  expect(requestProducts(writeText.mock.calls[0][0])).toMatchObject([{ totalPacksInCart: 3, quantitySource: "manual" }]);
  openDetails();
  fireEvent.click(screen.getByRole("button", { name: `Use suggested quantity for ${productName}` }));
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
});

test("keeps manual and starting quantity sources distinct in the same confirmation", async () => {
  const writeText = clipboardSuccess();
  setup({ draft: { ...draft, selections: [
    { ...draft.selections[0], suggestedPurchase: "some" },
    { ...draft.selections[0], ingredientKey: "rice", ingredientName: "Rice", suggestedPurchase: "some", confirmationToken: "rice-token",
      product: { ...draft.selections[0].product, name: "Rice bag", url: "https://www.sayweee.com/product/rice" } },
  ] } });
  enterPacks("2");
  fireEvent.click(confirmButton());
  await screen.findByText(copiedMessage);
  expect(requestProducts(writeText.mock.calls[0][0])).toMatchObject([
    { productName, totalPacksInCart: 2, quantitySource: "manual" },
    { productName: "Rice bag", totalPacksInCart: 1, quantitySource: "starting" },
  ]);
});

test("invalidates completed confirmation after a package-size edit even when reverted", async () => {
  clipboardSuccess();
  setup();
  fireEvent.click(confirmButton());
  await screen.findByText(copiedMessage);
  openDetails();
  const size = screen.getByRole("textbox", { name: `Package size for ${productName}` });
  fireEvent.change(size, { target: { value: "500 g" } });
  fireEvent.change(size, { target: { value: "" } });
  expect(screen.queryByText(copiedMessage)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your request for Muse")).not.toBeInTheDocument();
  expect(confirmButton()).toBeEnabled();
});

test("calculates and exports a customer-supplied package size retained across reopening", async () => {
  const writeText = clipboardSuccess();
  const name = "Firm tofu";
  const view = setup({ draft: { ...draft, selections: [{ ...draft.selections[0], product: { ...draft.selections[0].product, name } }] } });
  openDetails(name);
  fireEvent.change(screen.getByRole("textbox", { name: `Package size for ${name}` }), { target: { value: "350 g" } });
  expect(packs(name)).toHaveValue(2);
  fireEvent.click(confirmButton());
  await screen.findByText(copiedMessage);
  expect(requestProducts(writeText.mock.calls[0][0])).toMatchObject([{ totalPacksInCart: 2, reviewedPackageSize: "350 g" }]);
  view.update({ open: false }); view.update({ open: true });
  openDetails(name);
  expect(screen.getByRole("textbox", { name: `Package size for ${name}` })).toHaveValue("350 g");
});

test("corrects a listed size without overwriting an explicit count", () => {
  setup(); enterPacks("4");
  openDetails();
  fireEvent.change(screen.getByRole("textbox", { name: `Package size for ${productName}` }), { target: { value: "200 g" } });
  expect(packs()).toHaveValue(4);
  fireEvent.click(screen.getByRole("button", { name: `Use suggested quantity for ${productName}` }));
  expect(packs()).toHaveValue(3);
});

test("quantity step controls keep counts within bounds and make edits explicit", async () => {
  const writeText = clipboardSuccess();
  setup();
  const increase = screen.getByRole("button", { name: `Increase packs of ${productName}` });
  const decrease = screen.getByRole("button", { name: `Decrease packs of ${productName}` });
  fireEvent.click(increase); expect(packs()).toHaveValue(3);
  fireEvent.click(decrease); expect(packs()).toHaveValue(2);
  fireEvent.click(confirmButton());
  await screen.findByText(copiedMessage);
  expect(requestProducts(writeText.mock.calls[0][0])).toMatchObject([{ totalPacksInCart: 2, quantitySource: "manual" }]);
  enterPacks("99"); fireEvent.click(increase); expect(packs()).toHaveValue(99);
  enterPacks("1"); fireEvent.click(decrease); expect(packs()).toHaveValue(1);
});

test("requires an explicit total when the product also serves an ingredient marked added", () => {
  setup({ draft: { ...draft, selections: [
    { ...draft.selections[0], confirmed: true },
    { ...draft.selections[0], ingredientKey: "more-tofu", suggestedPurchase: "350 g" },
  ] } });
  expect(packs()).toHaveValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Fix quantities" }));
  expect(packs()).toHaveFocus();
  openDetails();
  expect(screen.getByText(/Check its current cart quantity/)).toBeVisible();
  enterPacks("3");
  expect(confirmButton()).toBeEnabled();
});

test("closes on Escape and returns focus to the opener", async () => {
  const trigger = document.createElement("button"); trigger.textContent = "Prepare";
  document.body.appendChild(trigger); trigger.focus();
  const view = setup();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(view.props.onClose).toHaveBeenCalledOnce();
  view.update({ open: false });
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
});
