import { useMemo, useState } from "react";
import { getRecipeTags, type Recipe, type RecipeTagSlug } from "@cooking/shared";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

export type TagFilter = "all" | RecipeTagSlug;

export function useRecipePickerData(recipes: Recipe[]) {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const debouncedSearch = useDebouncedValue(search, 250);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return [...recipes]
      .filter((r) => {
        if (q && !r.title.toLowerCase().includes(q)) return false;
        if (tagFilter !== "all") {
          const tags = getRecipeTags(r);
          if (!tags.includes(tagFilter)) return false;
        }
        return true;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [recipes, debouncedSearch, tagFilter]);

  return { search, setSearch, tagFilter, setTagFilter, filtered };
}
