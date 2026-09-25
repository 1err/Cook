import { useState } from "react";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MESSAGE_MAP, type Recipe } from "@cooking/shared";
import { DraftRecipeEditor } from "../import/DraftRecipeEditor";
import RecipeEditPage from "../library/[id]/page";

const { request, access, generate, push } = vi.hoisted(() => ({ request: vi.fn(), access: vi.fn(), generate: vi.fn(), push: vi.fn() }));
vi.mock("../lib/api", () => ({ apiFetch: request, webApiClient: { recipes: { imageGenerationAccess: access, generateImage: generate, imageGenerationStatus: vi.fn() } } }));
vi.mock("../lib/i18n", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? "")) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "recipe-image" }), useRouter: () => ({ push }) }));
vi.mock("./RequireAuth", () => ({ RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</> }));

const recipe: Recipe = { id: "recipe-image", title: "Braised tofu", thumbnail_url: "https://example.com/original.jpg", description: "Tofu and eggplant.", ingredients: [{ name: "Tofu", quantity: "1 block" }], steps: [{ text: "Braise in a clay pot.", duration_seconds: 600, duration_source: "stated", attention_type: "passive", action_type: "simmer" }], tips: [], equipment: [], library_tags: [] };

beforeEach(() => {
  access.mockReset().mockResolvedValue({ enabled: true, allowed: true, reason: null, daily_limit: 3, remaining: 3, resets_at: "2026-09-26T00:00:00Z" });
  generate.mockReset().mockImplementation(async ({ request_id }) => ({ request_id, status: "completed", file_url: "https://example.com/generated.webp" }));
  request.mockReset().mockImplementation(async (path: string) => new Response(JSON.stringify(path.includes("editor-status") ? { can_manage: false } : recipe), { status: 200 }));
  push.mockReset();
});
afterEach(cleanup);

test("compact import editor preserves concurrent edits and saves only the accepted AI cover", async () => {
  const user = userEvent.setup();
  let finish!: (value: unknown) => void;
  generate.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  function Editor() {
    const [draft, setDraft] = useState(recipe);
    return <DraftRecipeEditor draft={draft} onChange={setDraft} onBack={vi.fn()} onSaveSuccess={vi.fn()} />;
  }
  render(<Editor />);
  await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
  fireEvent.change(screen.getByLabelText("Recipe title"), { target: { value: "My braised tofu" } });
  fireEvent.change(screen.getByLabelText("Ingredient 1", { exact: true }), { target: { value: "Silken tofu" } });
  await act(async () => { finish({ request_id: generate.mock.calls[0][0].request_id, status: "completed", file_url: "https://example.com/generated.webp" }); });
  expect(screen.getByRole("img", { name: "Cover image" })).toHaveAttribute("src", recipe.thumbnail_url);
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Use image" }));
  await user.click(screen.getByRole("button", { name: "Save recipe" }));
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ title: "My braised tofu", thumbnail_url: "https://example.com/generated.webp", ingredients: [{ name: "Silken tofu" }] });
});

test("compact saved recipe editor persists the accepted AI cover with current fields", async () => {
  const user = userEvent.setup();
  render(<RecipeEditPage />);
  fireEvent.change(await screen.findByLabelText("Recipe title"), { target: { value: "Tofu and eggplant" } });
  await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
  await screen.findByRole("img", { name: "Generated recipe photo preview" });
  expect(request.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Use image" }));
  await user.click(screen.getByRole("button", { name: /^Save$/ }));
  const [, options] = request.mock.calls.find(([, input]) => input?.method === "PATCH")!;
  expect(JSON.parse(options.body)).toMatchObject({ title: "Tofu and eggplant", thumbnail_url: "https://example.com/generated.webp" });
});

test("replacing a recipe draft clears the previous candidate while normal title edits do not", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const props = { onChange, onBack: vi.fn(), onSaveSuccess: vi.fn() };
  const { rerender } = render(<DraftRecipeEditor {...props} draft={recipe} />);
  await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
  await screen.findByRole("button", { name: "Use image" });
  rerender(<DraftRecipeEditor {...props} draft={{ ...recipe, title: "Same draft edited" }} />);
  expect(screen.getByRole("button", { name: "Use image" })).toBeVisible();
  rerender(<DraftRecipeEditor {...props} draft={{ ...recipe, id: "different-recipe", title: "Chicken" }} />);
  expect(screen.queryByRole("button", { name: "Use image" })).not.toBeInTheDocument();
});
