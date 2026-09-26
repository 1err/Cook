import { describe, expect, it } from "vitest";

import {
  MissingMenuRecipeError,
  createMenuDraft,
  createMenuSection,
  moveMenuItem,
  reconcileMenuSelection,
  updateMenuItem,
} from "./draft";
import { MENU_STYLE_IDS, MENU_STYLES } from "./styles";

const labels = { title: "From my kitchen", section: "Dishes" };

describe("createMenuDraft", () => {
  it("snapshots exactly the requested recipes without hiding library items", () => {
    const recipes = Array.from({ length: 120 }, (_, index) => ({
      id: `recipe-${index}`,
      title: `Dish ${index}`,
      description: `Description ${index}`,
    }));
    const matchingIds = recipes.filter((_, index) => index % 3 === 0).map((recipe) => recipe.id);

    const fullLibrary = createMenuDraft(recipes, recipes.map((recipe) => recipe.id), labels);
    const matching = createMenuDraft(recipes, matchingIds, labels);

    expect(fullLibrary.items).toHaveLength(120);
    expect(fullLibrary.items[fullLibrary.items.length - 1]?.recipeId).toBe("recipe-119");
    expect(matching.items.map((item) => item.recipeId)).toEqual(matchingIds);
  });

  it("collapses duplicate selections and copies only editable menu fields", () => {
    const recipes = Object.freeze([
      Object.freeze({ id: "a", title: "豆腐", description: "Soft tofu" }),
      Object.freeze({ id: "b", title: "Soup", description: null }),
    ]);

    const draft = createMenuDraft(recipes, ["a", "a", "b"], labels);

    expect(draft).toEqual({
      title: "From my kitchen",
      subtitle: "",
      styleId: "cozy-cafe",
      instructions: "",
      sections: [{ id: "dishes", title: "Dishes" }],
      items: [
        { recipeId: "a", sectionId: "dishes", name: "豆腐", description: "Soft tofu" },
        { recipeId: "b", sectionId: "dishes", name: "Soup", description: "" },
      ],
      artwork: null,
    });
    expect(Object.keys(draft.items[0]).sort()).toEqual([
      "description",
      "name",
      "recipeId",
      "sectionId",
    ]);
    expect(recipes[0].title).toBe("豆腐");
  });

  it("rejects every missing selected recipe ID explicitly", () => {
    const recipes = [{ id: "a", title: "Tofu", description: null }];

    expect(() => createMenuDraft(recipes, ["missing", "a", "also-missing", "missing"], labels)).toThrow(
      expect.objectContaining<Partial<MissingMenuRecipeError>>({
        name: "MissingMenuRecipeError",
        missingIds: ["missing", "also-missing"],
      }),
    );
  });
});

describe("reconcileMenuSelection", () => {
  it("retains edited text and user order, removes deselections, and appends new dishes", () => {
    const recipes = Object.freeze([
      Object.freeze({ id: "a", title: "豆腐", description: "Soft tofu" }),
      Object.freeze({ id: "b", title: "Soup", description: null }),
      Object.freeze({ id: "c", title: "Salad", description: "Fresh greens" }),
    ]);
    const original = createMenuDraft(recipes, ["a", "b"], labels);
    const reordered = moveMenuItem(original, "b", "dishes", 0);
    const edited = updateMenuItem(reordered, "a", {
      name: "House tofu",
      description: "A long description stays exactly as entered\nwithout being clipped.",
    });

    const expanded = reconcileMenuSelection(edited, recipes, ["a", "b", "c", "c"]);
    const reduced = reconcileMenuSelection(expanded, recipes, ["a", "c"]);

    expect(expanded.items.map((item) => item.recipeId)).toEqual(["b", "a", "c"]);
    expect(expanded.items.find((item) => item.recipeId === "a")).toMatchObject({
      name: "House tofu",
      description: "A long description stays exactly as entered\nwithout being clipped.",
    });
    expect(reduced.items.map((item) => item.recipeId)).toEqual(["a", "c"]);
    expect(expanded).not.toBe(edited);
    expect(edited.items.map((item) => item.recipeId)).toEqual(["b", "a"]);
    expect(recipes[0].title).toBe("豆腐");
  });

  it("rejects selected IDs that no longer exist in the supplied library", () => {
    const recipes = [{ id: "a", title: "Tofu", description: null }];
    const draft = createMenuDraft(recipes, ["a"], labels);

    expect(() => reconcileMenuSelection(draft, recipes, ["a", "deleted"])).toThrow(
      expect.objectContaining({ missingIds: ["deleted"] }),
    );
  });
});

describe("menu item and section editing", () => {
  it("moves an item to a section at a section-relative index without mutating the draft", () => {
    const recipes = [
      { id: "a", title: "A", description: "" },
      { id: "b", title: "B", description: "" },
      { id: "c", title: "C", description: "" },
    ];
    const draft = createMenuDraft(recipes, ["a", "b", "c"], labels);
    const withDrinks = { ...draft, sections: [...draft.sections, { id: "drinks", title: "Drinks" }] };
    const firstMove = moveMenuItem(withDrinks, "c", "drinks", 0);
    const secondMove = moveMenuItem(firstMove, "b", "drinks", 0);

    expect(secondMove.items.map(({ recipeId, sectionId }) => [recipeId, sectionId])).toEqual([
      ["a", "dishes"],
      ["b", "drinks"],
      ["c", "drinks"],
    ]);
    expect(withDrinks.items.map((item) => item.sectionId)).toEqual(["dishes", "dishes", "dishes"]);
  });

  it("rejects missing items and sections instead of silently ignoring them", () => {
    const draft = createMenuDraft([{ id: "a", title: "A", description: "" }], ["a"], labels);

    expect(() => moveMenuItem(draft, "missing", "dishes", 0)).toThrow(/missing menu item/i);
    expect(() => moveMenuItem(draft, "a", "missing-section", 0)).toThrow(/missing menu section/i);
    expect(() => updateMenuItem(draft, "missing", { name: "Nope" })).toThrow(/missing menu item/i);
  });

  it("updates an item immutably and creates new sections with UUID IDs", () => {
    const draft = createMenuDraft([{ id: "a", title: "A", description: "Original" }], ["a"], labels);
    const updated = updateMenuItem(draft, "a", { name: "Edited", description: "" });
    const section = createMenuSection("Desserts");

    expect(updated.items[0]).toEqual({
      recipeId: "a",
      sectionId: "dishes",
      name: "Edited",
      description: "",
    });
    expect(draft.items[0].name).toBe("A");
    expect(section.title).toBe("Desserts");
    expect(section.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("menu style presets", () => {
  it("provides every allowlisted style with CSS-safe colors and inert SVG ornament markup", () => {
    expect(MENU_STYLE_IDS).toEqual([
      "cozy-cafe",
      "french-bistro",
      "garden-table",
      "italian-supper",
      "chinese-teahouse",
      "minimal-modern",
    ]);
    expect(MENU_STYLES.map((style) => style.id)).toEqual(MENU_STYLE_IDS);

    for (const style of MENU_STYLES) {
      expect(style.labelKey).toBe(`menu.style.${style.id}`);
      expect(style.colors.background).toMatch(/^#[0-9A-F]{6}$/);
      expect(style.colors.panel).toMatch(/^#[0-9A-F]{6}$/);
      expect(style.colors.text).toMatch(/^#[0-9A-F]{6}$/);
      expect(style.colors.accent).toMatch(/^#[0-9A-F]{6}$/);
      expect(["MenuSerif", "MenuSans"]).toContain(style.titleFamily);
      expect(["MenuSerif", "MenuSans"]).toContain(style.bodyFamily);
      expect(style.ornamentSvg).toMatch(/^<svg /);
      expect(style.ornamentSvg).not.toMatch(/<script|on\w+=|<text/i);
    }
  });
});
