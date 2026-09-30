import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImportPage from "./page";

const { mockApiFetch, mockPush } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { id: "test-user" }, loading: false }) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({ apiFetch: mockApiFetch, webApiClient: { recipes: { importCapabilities: () => Promise.resolve({ video_analysis: false, media_upload: false, max_media_bytes: 0 }), createImportJob: () => Promise.reject(new Error("TikTok only exposed an attribution caption.")), cancelImportJob: vi.fn() } } }));
vi.mock("../lib/editorialCopy", () => ({
  useEditorialCopy: () => ({ "import.tagline": "Import recipes" }),
}));
vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => ({ "import.sourceUrlLabel": "YouTube or RedNote URL", "import.videoLink": "Video link", "import.recipeText": "Paste recipe text", "import.createDraft": "Create draft" })[key] || key,
}));

beforeEach(() => {
  mockPush.mockReset();
  mockApiFetch.mockReset().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: "TikTok only exposed an attribution caption." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(cleanup);

describe("ImportPage source errors", () => {
  it("renders backend detail and clears the stale error on source edits and mode changes", async () => {
    const user = userEvent.setup();
    render(<ImportPage />);

    const url = screen.getByLabelText("YouTube or RedNote URL");
    await user.type(url, "https://vm.tiktok.com/ZMrecipe/");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TikTok only exposed an attribution caption.",
    );

    await user.type(screen.getByLabelText("YouTube or RedNote URL"), "x");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TikTok only exposed an attribution caption.",
    );

    await user.click(screen.getByRole("tab", { name: "Paste recipe text" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

it('creates and saves a manual recipe without calling a parsing provider', async () => {
  const user = userEvent.setup();
  mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'manual-saved' }), { status: 200 }));
  render(<ImportPage />);
  await user.click(screen.getByRole('button', { name: 'import.createManually' }));
  expect(mockApiFetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'import.saveRecipe' })).toBeDisabled();
  await user.type(screen.getByLabelText('recipe.recipeTitle'), 'Family noodles');
  await user.type(screen.getByLabelText('recipe.ingredient 1'), 'Noodles');
  await user.type(screen.getByLabelText('recipe.originalAmount 1'), '200 g');
  await user.type(screen.getByLabelText('recipe.tutorial.editor.stepLabel'), 'Boil noodles.');
  await user.click(screen.getByRole('button', { name: 'import.saveRecipe' }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/recipe/manual-saved'));
  expect(mockApiFetch).toHaveBeenCalledTimes(1);
  const [endpoint, options] = mockApiFetch.mock.calls[0];
  expect(endpoint).toBe('/recipes');
  expect(JSON.parse(options.body)).toMatchObject({ title: 'Family noodles', source_url: null, ingredients: [{ name: 'Noodles', quantity: '200 g' }], steps: [{ text: 'Boil noodles.' }] });
});

it('does not navigate to an old manual save after the account view unmounts', async () => {
  const user = userEvent.setup();
  let finish!: (response: Response) => void;
  mockApiFetch.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  const rendered = render(<ImportPage />);
  await user.click(screen.getByRole('button', { name: 'import.createManually' }));
  await user.type(screen.getByLabelText('recipe.recipeTitle'), 'Noodles');
  await user.type(screen.getByLabelText('recipe.ingredient 1'), 'Noodles');
  await user.type(screen.getByLabelText('recipe.tutorial.editor.stepLabel'), 'Boil noodles.');
  await user.click(screen.getByRole('button', { name: 'import.saveRecipe' }));
  rendered.unmount();
  finish(new Response(JSON.stringify({ id: 'previous-user-recipe' })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(mockPush).not.toHaveBeenCalled();
});
