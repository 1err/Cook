import type { Language } from "./i18n";

export const GROCERY_CATEGORY_ORDER = [
  "Produce",
  "Dairy",
  "Meat & Seafood",
  "Pantry & Dry Goods",
  "Frozen",
  "Bakery",
  "Other",
] as const;

export type GroceryCategory = (typeof GROCERY_CATEGORY_ORDER)[number];

export const CATEGORY_TRANSLATIONS: Record<GroceryCategory, Record<Language, string>> = {
  Produce: { en: "Produce", zh: "蔬菜水果" },
  Dairy: { en: "Dairy", zh: "乳制品" },
  "Meat & Seafood": { en: "Meat & Seafood", zh: "肉类海鲜" },
  "Pantry & Dry Goods": { en: "Pantry & Dry Goods", zh: "粮油干货" },
  Frozen: { en: "Frozen", zh: "冷冻食品" },
  Bakery: { en: "Bakery", zh: "烘焙面包" },
  Other: { en: "Other", zh: "其他" },
};

const KEYWORDS: Record<string, string[]> = {
  Produce: [
    "garlic", "onion", "potato", "carrot", "tomato", "ginger", "scallion", "green onion", "cabbage",
    "broccoli", "spinach", "mushroom", "pepper", "celery", "lettuce", "cucumber", "pea", "bean sprout",
    "corn", "leek", "shallot", "bell pepper", "chili", "eggplant", "zucchini", "squash", "kale",
    "bok choy", "apple", "banana", "lemon", "lime", "herb", "cilantro", "parsley", "basil", "mint",
  ],
  "Meat & Seafood": [
    "pork", "beef", "chicken", "fish", "shrimp", "salmon", "tuna", "crab", "lamb", "turkey", "sausage",
    "bacon", "ground", "tilapia", "cod", "steak", "rib", "wing",
  ],
  "Pantry & Dry Goods": [
    "salt", "sugar", "oil", "vinegar", "soy sauce", "flour", "starch", "sauce", "broth", "wine", "baking",
    "honey", "sesame", "stock", "mirin", "rice", "noodle", "pasta", "bean paste", "doubanjiang", "spice",
    "cumin", "paprika",
  ],
  Dairy: ["milk", "cheese", "butter", "cream", "yogurt", "mozzarella", "cheddar"],
  Frozen: ["frozen", "ice cream"],
  Bakery: ["bread", "bun", "tortilla", "pita", "bagel", "roll"],
};

export function guessGroceryCategory(name: string): GroceryCategory {
  const lower = name.toLowerCase();
  for (const cat of GROCERY_CATEGORY_ORDER) {
    if (cat === "Other") continue;
    const words = KEYWORDS[cat];
    if (words?.some((k) => lower.includes(k))) return cat;
  }
  return "Other";
}

export function normalizeGroceryCategory(raw: string | undefined | null, name: string): GroceryCategory {
  const s = (raw || "").trim();
  if (!s) return guessGroceryCategory(name);
  const found = GROCERY_CATEGORY_ORDER.find((c) => c.toLowerCase() === s.toLowerCase());
  if (found) return found;
  const partial = GROCERY_CATEGORY_ORDER.find((c) => s.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(s.toLowerCase()));
  if (partial) return partial;
  return guessGroceryCategory(name);
}

export function getDisplayCategory(raw: string | undefined | null, name: string, language: Language): string {
  const normalized = normalizeGroceryCategory(raw, name);
  return CATEGORY_TRANSLATIONS[normalized]?.[language] || CATEGORY_TRANSLATIONS.Other[language];
}

export const CATEGORY_ICONS: Record<GroceryCategory, string> = {
  Produce: "eco",
  Dairy: "egg",
  "Meat & Seafood": "set_meal",
  "Pantry & Dry Goods": "kitchen",
  Frozen: "ac_unit",
  Bakery: "bakery_dining",
  Other: "shopping_bag",
};

export const CATEGORY_MATERIAL_ICONS: Record<GroceryCategory, string> = {
  Produce: "eco",
  Dairy: "egg_alt",
  "Meat & Seafood": "restaurant",
  "Pantry & Dry Goods": "inventory_2",
  Frozen: "ac_unit",
  Bakery: "bakery_dining",
  Other: "shopping_bag",
};

export function groceryCategoryBentoSpan(_cat: GroceryCategory): 6 {
  return 6;
}
