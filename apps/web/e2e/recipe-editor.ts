import { type Page } from "@playwright/test";

export async function selectEditorSection(page: Page, id: string) {
  const tab = page.locator("#tab-" + id);
  if (await tab.isVisible()) await tab.click();
  else await page.getByRole("combobox", { name: "Recipe editor section" }).selectOption(id);
}
