import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe, RecipeStep } from "../../../../types";
import TutorialEditPage from "./page";

const { mockApiFetch, mockPush } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "recipe-1" }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("../../../../components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../../lib/api", () => ({ apiFetch: mockApiFetch }));

vi.mock("../../../../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "common.loading": "Loading...",
      "recipe.steps": "Steps",
      "recipe.steps.empty": "No steps",
      "recipe.step.addRow": "Add step",
      "recipe.step.textPlaceholder": "Step instructions",
      "recipe.tutorial.edit": "Edit tutorial",
      "recipe.tutorial.cancel": "Cancel",
      "recipe.tutorial.save": "Save tutorial",
      "recipe.tutorial.editor.estimate": "Estimate missing tutorial details",
      "recipe.tutorial.editor.estimating": "Estimating tutorial details...",
      "recipe.tutorial.editor.estimateError": "Couldn't estimate tutorial details. Try again.",
      "recipe.tutorial.editor.saveError": "Couldn't save the tutorial. Try again.",
      "recipe.tutorial.editor.loadError": "Couldn't load the tutorial.",
      "recipe.tutorial.editor.duration": "Duration",
      "recipe.tutorial.editor.attention": "Attention",
      "recipe.tutorial.editor.illustration": "Illustration",
      "recipe.tutorial.editor.stepLabel": "Step {step}",
      "recipe.tutorial.editor.durationLabel": "Step {step} duration",
      "recipe.tutorial.editor.durationMinutes": "Step {step} minutes",
      "recipe.tutorial.editor.durationSeconds": "Step {step} seconds",
      "recipe.tutorial.editor.durationInvalid": "Enter a duration from 1 second to 24 hours.",
      "recipe.tutorial.editor.illustrationLabel": "Step {step} illustration",
      "recipe.tutorial.editor.moveUp": "Move step {step} up",
      "recipe.tutorial.editor.moveDown": "Move step {step} down",
      "recipe.tutorial.editor.remove": "Remove step {step}",
      "recipe.tutorial.source.fallback": "Rough estimate",
      "recipe.tutorial.source.estimated": "AI estimated",
      "recipe.tutorial.attention.handsOn": "Hands-on",
      "recipe.tutorial.attention.passive": "Passive",
      "recipe.tutorial.action.simmer": "Simmer",
      "recipe.tutorial.action.other": "Other",
    };
    return (messages[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => String(vars?.[name] ?? ""),
    );
  },
}));

const fallbackStep: RecipeStep = {
  id: "d042d265-8ac1-46cf-9d26-0c459538b8bb",
  text: "Simmer until glossy.",
  duration_seconds: 300,
  duration_source: "fallback",
  attention_type: "hands_on",
  action_type: "other",
  image_url: "https://example.com/preserved.jpg",
};

const recipe: Recipe = {
  id: "recipe-1",
  title: "Braised tofu",
  ingredients: [],
  steps: [fallbackStep],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestOptionsAt(method: string): RequestInit | undefined {
  return mockApiFetch.mock.calls.find(([, options]) => options?.method === method)?.[1];
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockPush.mockReset();
  mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
    if (path === "/recipes/recipe-1" && !options?.method) return Promise.resolve(jsonResponse(recipe));
    if (path === "/recipes/recipe-1" && options?.method === "PATCH") {
      return Promise.resolve(jsonResponse(recipe));
    }
    if (path === "/recipes/recipe-1/tutorial/estimate" && options?.method === "POST") {
      const sent = JSON.parse(String(options.body)) as { steps: RecipeStep[] };
      return Promise.resolve(jsonResponse({
        steps: sent.steps.map((step) => ({
          ...step,
          duration_seconds: 480,
          duration_source: "estimated",
          attention_type: "passive",
          action_type: "simmer",
        })),
      }));
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(cleanup);

describe("TutorialEditPage", () => {
  it("loads an independent draft and keeps estimation preview-only", async () => {
    const user = userEvent.setup();
    render(<TutorialEditPage />);

    const instructions = await screen.findByRole("textbox", { name: "Step 1" });
    await user.clear(instructions);
    await user.type(instructions, "Simmer the edited sauce.");
    await user.click(screen.getByRole("button", { name: "Estimate missing tutorial details" }));

    await waitFor(() => expect(screen.getByText("AI estimated")).toBeVisible());
    expect(instructions).toHaveValue("Simmer the edited sauce.");
    expect(screen.getByLabelText("Step 1 minutes")).toHaveValue(8);
    expect(screen.getByRole("button", { name: "Estimate missing tutorial details" })).toBeDisabled();
    expect(requestOptionsAt("POST")).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(requestOptionsAt("POST")?.body))).toEqual({
      steps: [{ ...fallbackStep, text: "Simmer the edited sauce." }],
    });
    expect(requestOptionsAt("PATCH")).toBeUndefined();
    expect(recipe.steps?.[0]).toEqual(fallbackStep);
  });

  it("cancels back to detail without sending a patch", async () => {
    const user = userEvent.setup();
    render(<TutorialEditPage />);

    const instructions = await screen.findByRole("textbox", { name: "Step 1" });
    await user.clear(instructions);
    await user.type(instructions, "Unsaved instructions");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockPush).toHaveBeenCalledWith("/recipe/recipe-1");
    expect(requestOptionsAt("PATCH")).toBeUndefined();
  });

  it("saves only the edited steps and returns to recipe detail", async () => {
    const user = userEvent.setup();
    render(<TutorialEditPage />);

    const instructions = await screen.findByRole("textbox", { name: "Step 1" });
    await user.clear(instructions);
    await user.type(instructions, "Simmer gently.");
    await user.click(screen.getByRole("button", { name: "Save tutorial" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/recipe/recipe-1"));
    const patch = requestOptionsAt("PATCH");
    expect(patch).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(patch?.body))).toEqual({
      steps: [{ ...fallbackStep, text: "Simmer gently." }],
    });
  });

  it("preserves edits after an estimate failure and allows a retry", async () => {
    const user = userEvent.setup();
    let estimateAttempts = 0;
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      if (!options?.method) return Promise.resolve(jsonResponse(recipe));
      if (path.endsWith("/tutorial/estimate")) {
        estimateAttempts += 1;
        if (estimateAttempts === 1) return Promise.resolve(jsonResponse({ detail: "Unavailable" }, 503));
        const sent = JSON.parse(String(options.body)) as { steps: RecipeStep[] };
        return Promise.resolve(jsonResponse({ steps: sent.steps.map((step) => ({
          ...step,
          duration_seconds: 420,
          duration_source: "estimated",
          attention_type: "passive",
          action_type: "simmer",
        })) }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<TutorialEditPage />);

    const instructions = await screen.findByRole("textbox", { name: "Step 1" });
    await user.clear(instructions);
    await user.type(instructions, "Keep this local edit.");
    const estimate = screen.getByRole("button", { name: "Estimate missing tutorial details" });
    await user.click(estimate);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't estimate tutorial details. Try again.",
    );
    expect(instructions).toHaveValue("Keep this local edit.");
    expect(estimate).toBeEnabled();

    await user.click(estimate);
    await waitFor(() => expect(screen.getByText("AI estimated")).toBeVisible());
    expect(instructions).toHaveValue("Keep this local edit.");
  });

  it("keeps an invalid or failed-save draft in place for correction and retry", async () => {
    const user = userEvent.setup();
    let saveAttempts = 0;
    mockApiFetch.mockImplementation((path: string, options?: RequestInit) => {
      if (!options?.method) return Promise.resolve(jsonResponse(recipe));
      if (options.method === "PATCH") {
        saveAttempts += 1;
        return Promise.resolve(jsonResponse(recipe, saveAttempts === 1 ? 500 : 200));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<TutorialEditPage />);

    const instructions = await screen.findByRole("textbox", { name: "Step 1" });
    const save = screen.getByRole("button", { name: "Save tutorial" });
    await user.clear(instructions);
    await user.type(instructions, "Retry this exact edit.");
    await user.clear(screen.getByLabelText("Step 1 minutes"));
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Step 1 minutes"), "5");
    expect(save).toBeEnabled();
    await user.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the tutorial. Try again.");
    expect(instructions).toHaveValue("Retry this exact edit.");
    expect(save).toBeEnabled();
    expect(mockPush).not.toHaveBeenCalled();

    await user.click(save);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/recipe/recipe-1"));
  });
});
