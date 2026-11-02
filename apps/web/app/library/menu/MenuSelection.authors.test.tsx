import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Recipe } from "@cooking/shared";
import { MenuSelection } from "./MenuSelection";
vi.mock("../../lib/i18n", async () => {
  const { MESSAGE_MAP } = await import("@cooking/shared");
  return { useT: () => (key: string, values?: Record<string, string | number>) => (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? "")) };
});
afterEach(cleanup);
const recipes: Recipe[] = [
  { id: "lin", title: "Noodles", ingredients: [], library_tags: ["chinese"], author: { id: "author-1", name: "Wang Gang", aliases: ["王刚"] } },
  { id: "other", title: "Noodles", ingredients: [], library_tags: ["chinese"], author: { id: "author-2", name: "Ming", aliases: [] } },
  { id: "wrong-tag", title: "Tofu", ingredients: [], library_tags: ["japanese"], author: { id: "author-1", name: "Wang Gang", aliases: ["王刚"] } },
];

test.each(["王刚", "Wang Gang"])("menu selection retains a Library creator query (%s), composes tags, and shows a plain credit", query => {
  const changed = vi.fn();
  render(<MenuSelection recipes={recipes} selectedIds={[]} onChange={changed} initialSearch={query} initialFilters={["chinese"]} />);
  const choice = screen.getByRole("checkbox");
  expect(choice).toHaveAccessibleName(/Noodles/);
  expect(screen.getByText("By Wang Gang")).toBeVisible();
  expect(screen.queryByText("By Ming")).not.toBeInTheDocument();
  expect(screen.getByText("By Wang Gang").closest("a, button")).toBeNull();
  fireEvent.click(choice);
  expect(changed).toHaveBeenCalledWith(["lin"]);
});
