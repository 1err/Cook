import type { RecipeAuthor } from "./types";

type SearchableRecipe = { title: string; author?: RecipeAuthor | null };
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
// Directory keys use Unicode casefold; these expansions cover common creator
// names where lowercasing alone differs (German sharp s and Greek final sigma).
const foldAuthor = (value: string) => normalize(value).replace(/ß/g, "ss").replace(/ς/g, "σ");

/** Same creator metadata supports library, planner and cooking recipe pickers. */
export function matchesRecipeSearch(recipe: SearchableRecipe, query: string): boolean {
  const terms = normalize(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const title = normalize(recipe.title);
  const author = foldAuthor([recipe.author?.name ?? "", ...(recipe.author?.aliases ?? [])].join(" "));
  return terms.every(term => title.includes(term) || author.includes(foldAuthor(term)));
}
