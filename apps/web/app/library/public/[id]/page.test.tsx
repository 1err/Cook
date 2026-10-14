import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MESSAGE_MAP, type Recipe } from "@cooking/shared";
import PublicRecipePage from "./page";

const { apiFetch, route, account } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  route: { id: "public-recipe" },
  account: { id: "regular-user" },
}));

vi.mock("next/navigation", () => ({ useParams: () => route }));
vi.mock("../../../lib/auth", () => ({ useAuth: () => ({ user: account }) }));
vi.mock("../../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../../lib/api", () => ({ apiFetch }));
vi.mock("../../../lib/i18n", () => ({
  useT: () => translate,
}));

function translate(key: string, vars?: Record<string, string | number>) {
  return (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

const publicRecipe: Recipe = {
  id: "public-recipe",
  title: "Public tomato noodles",
  description: "A simple bowl for supper.",
  is_public_catalog: true,
  source_url: "https://example.com/noodles",
  thumbnail_url: "https://example.com/noodles.jpg",
  ingredients: [{ name: "Noodles", quantity: "200 g", metric_quantity: "200 g" }],
  total_time_minutes: 15,
  library_tags: ["main_dish"],
  equipment: ["Saucepan"],
  tips: ["Reserve some cooking water."],
  steps: [{
    id: "63ac3a73-c71b-4d96-a205-28e0b4cd36ce",
    text: "Simmer the tomatoes, then toss with noodles.",
    duration_seconds: 300,
    duration_source: "stated",
    attention_type: "hands_on",
    action_type: "simmer",
  }],
};

const savedCopy: Recipe = {
  ...publicRecipe,
  id: "my-copy",
  is_public_catalog: false,
  catalog_source_recipe_id: publicRecipe.id,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function fixture({ catalog = [publicRecipe], mine = [] as Recipe[] } = {}) {
  apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/recipes/catalog" && !options?.method) return json(catalog);
    if (path === "/recipes" && !options?.method) return json(mine);
    if (path === "/recipes/catalog/public-recipe/copy" && options?.method === "POST") return json(savedCopy);
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${path}`);
  });
}

beforeEach(() => {
  route.id = "public-recipe";
  account.id = "regular-user";
  apiFetch.mockReset();
  fixture();
});
afterEach(cleanup);

it("shows the timing breakdown on public details while leaving the source read-only", async () => {
  fixture({ catalog: [{ ...publicRecipe, total_time_minutes: 135,
    timing_summary: { hands_on_minutes: 15, passive_minutes: 120, is_estimate: false } }] });
  render(<PublicRecipePage />);
  expect(await screen.findByText("2 hr 15 min")).toBeVisible();
  expect(screen.getByText("15 min hands-on")).toBeVisible();
  expect(screen.getByText("2 hr passive")).toBeVisible();
  expect(screen.queryByRole("link", { name: /Edit/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add to my library" })).toBeEnabled();
});

it("lets a regular user read complete public details without copying or editing the original", async () => {
  render(<PublicRecipePage />);

  expect(await screen.findByRole("heading", { name: "Public tomato noodles" })).toBeVisible();
  expect(screen.getByText("Noodles")).toBeVisible();
  expect(screen.getByText("200 g")).toBeVisible();
  expect(screen.getByText("Simmer the tomatoes, then toss with noodles.")).toBeVisible();
  expect(screen.getByText("Reserve some cooking water.")).toBeVisible();
  expect(screen.getByRole("link", { name: /Public library/ })).toHaveAttribute("href", "/library?view=public");
  expect(screen.getByRole("link", { name: /Original video/ })).toHaveAttribute("href", "https://example.com/noodles");
  expect(screen.getByRole("button", { name: "Add to my library" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: /Edit|Cook|Meal planner/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit|Delete|Publish|cover/i })).not.toBeInTheDocument();
  expect(apiFetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it("keeps an empty public recipe readable without offering tutorial editing", async () => {
  fixture({ catalog: [{ ...publicRecipe, ingredients: [], steps: [] }] });
  render(<PublicRecipePage />);

  await screen.findByRole("heading", { name: "Public tomato noodles" });
  expect(screen.getByText("No tutorial steps have been added to this recipe.")).toBeVisible();
  expect(screen.queryByRole("link", { name: /Edit/ })).not.toBeInTheDocument();
});

it.each([{ catalog: [] }, { catalog: [{ ...publicRecipe, is_public_catalog: false }] }])("shows an unavailable state when the recipe is missing or unpublished", async (options) => {
  fixture(options);
  render(<PublicRecipePage />);

  expect(await screen.findByRole("heading", { name: "Recipe unavailable" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Public library/ })).toHaveAttribute("href", "/library?view=public");
  expect(screen.queryByRole("button", { name: "Add to my library" })).not.toBeInTheDocument();
});

it("retries a catalog failure without mistaking it for an unpublished recipe", async () => {
  apiFetch.mockImplementation(async (path: string) => path === "/recipes/catalog" ? json({}, 503) : json([]));
  render(<PublicRecipePage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this recipe.");
  expect(screen.queryByRole("heading", { name: "Recipe unavailable" })).not.toBeInTheDocument();
  fixture();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Public tomato noodles" })).toBeVisible();
});

it("keeps public details accessible when the personal library fails to load", async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === "/recipes/catalog") return json([publicRecipe]);
    throw new Error("Private library offline");
  });
  render(<PublicRecipePage />);

  expect(await screen.findByRole("heading", { name: "Public tomato noodles" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add to my library" })).toBeEnabled();
});

it.each([savedCopy, publicRecipe])("links to a recipe already in the user's library", async (owned) => {
  fixture({ mine: [owned] });
  render(<PublicRecipePage />);

  expect(await screen.findByRole("link", { name: "View my copy" })).toHaveAttribute("href", `/recipe/${owned.id}`);
  expect(screen.queryByRole("button", { name: "Add to my library" })).not.toBeInTheDocument();
});

it("copies only on request and links to the returned personal recipe", async () => {
  render(<PublicRecipePage />);
  fireEvent.click(await screen.findByRole("button", { name: "Add to my library" }));

  expect(await screen.findByRole("link", { name: "View my copy" })).toHaveAttribute("href", "/recipe/my-copy");
  expect(apiFetch.mock.calls.filter(([, options]) => options?.method)).toEqual([
    ["/recipes/catalog/public-recipe/copy", { method: "POST", headers: { "X-Chef-World-Account-ID": "regular-user" } }],
  ]);
  expect(screen.queryByRole("link", { name: /Edit/ })).not.toBeInTheDocument();
});

it("preserves the readable recipe and permits retry after copying fails", async () => {
  render(<PublicRecipePage />);
  await screen.findByRole("button", { name: "Add to my library" });
  apiFetch.mockResolvedValueOnce(json({}, 503));
  fireEvent.click(screen.getByRole("button", { name: "Add to my library" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not add this recipe.");
  expect(screen.getByRole("heading", { name: "Public tomato noodles" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add to my library" }));
  expect(await screen.findByRole("link", { name: "View my copy" })).toBeVisible();
});

it("removes stale details if the recipe is unpublished before copying", async () => {
  render(<PublicRecipePage />);
  await screen.findByRole("button", { name: "Add to my library" });
  apiFetch.mockResolvedValueOnce(json({}, 404));
  fireEvent.click(screen.getByRole("button", { name: "Add to my library" }));

  expect(await screen.findByRole("heading", { name: "Recipe unavailable" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Public tomato noodles" })).not.toBeInTheDocument();
});

it("does not transfer a pending copy result when a different recipe opens", async () => {
  const rendered = render(<PublicRecipePage />);
  await screen.findByRole("button", { name: "Add to my library" });
  let finish!: (response: Response) => void;
  apiFetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Add to my library" }));
  expect(screen.getByRole("button", { name: "Adding..." })).toBeDisabled();

  route.id = "different-recipe";
  fixture({ catalog: [{ ...publicRecipe, id: "different-recipe", title: "Another public recipe" }] });
  rendered.rerender(<PublicRecipePage />);
  await screen.findByRole("heading", { name: "Another public recipe" });
  await act(async () => finish(json(savedCopy)));
  expect(screen.getByRole("button", { name: "Add to my library" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "View my copy" })).not.toBeInTheDocument();
});

it.each(["javascript:alert(1)", "https://user:password@example.com/noodles"])("does not link unsafe recipe sources: %s", async (source_url) => {
  fixture({ catalog: [{ ...publicRecipe, source_url }] });
  render(<PublicRecipePage />);
  await screen.findByRole("heading", { name: "Public tomato noodles" });
  expect(screen.queryByRole("link", { name: /Original video/ })).not.toBeInTheDocument();
});


it("binds the owned-copy read to the same visible actor as public details", async () => {
  render(<PublicRecipePage />);
  await screen.findByText("Public tomato noodles");
  expect(apiFetch).toHaveBeenCalledWith("/recipes", {headers: {"X-Chef-World-Account-ID": "regular-user"}});
});
