import type { RecipeActionType } from "@cooking/shared";

export type RecipeStepIngredientVariant = "generic" | "meat" | "tofu" | "vegetable";

export type RecipeStepVisual = {
  actionType: RecipeActionType;
  ingredientVariant: RecipeStepIngredientVariant;
};

const INFERRED_ACTION_PATTERNS: ReadonlyArray<{
  actionType: Exclude<RecipeActionType, "other">;
  pattern: RegExp;
}> = [
  {
    actionType: "chop",
    pattern:
      /(?:切|剁|斩|切片|切块|切丁|切丝|切碎|切粒|颗粒|滚刀|slice|chop|dice|mince|julienne|\bcut\b)/iu,
  },
  {
    actionType: "mix",
    pattern: /(?:拌|混合|搅拌|搅匀|打散|mix|stir|whisk|combine|fold)/iu,
  },
  {
    actionType: "season",
    pattern: /(?:调味|撒盐|加盐|胡椒|香料|season|seasoning|\bsalt\b|pepper|spice)/iu,
  },
  {
    actionType: "sear",
    pattern: /(?:煎|炒|爆香|煸|sear|brown|pan[ -]?fry|stir[ -]?fry|saut[ée])/iu,
  },
  {
    actionType: "simmer",
    pattern: /(?:炖|焖|煨|小火|收汁|simmer|stew|braise|reduce)/iu,
  },
  {
    actionType: "boil",
    pattern: /(?:煮沸|烧开|沸腾|焯|水煮|boil|blanch|parboil)/iu,
  },
  {
    actionType: "bake",
    pattern: /(?:烘烤|烤箱|烤制|烤至|bake|roast|broil)/iu,
  },
  {
    actionType: "drain",
    pattern: /(?:沥|滤出|滤干|控干|drain|strain|colander)/iu,
  },
  {
    actionType: "assemble",
    pattern: /(?:组装|包起|卷起|折叠|叠放|assemble|wrap|stuff|layer|fill)/iu,
  },
  {
    actionType: "plate",
    pattern: /(?:装盘|盛出|上桌|摆盘|点缀|plate|serve|garnish)/iu,
  },
  {
    actionType: "rest",
    pattern: /(?:静置|醒面|冷却|放凉|松弛|rest|cool|let (?:it|the .+?) sit)/iu,
  },
  {
    actionType: "prep",
    pattern: /(?:准备|洗净|清洗|去皮|去籽|去蒂|trim|peel|wash|rinse|prepare)/iu,
  },
];

const TOFU_PATTERN = /(?:豆腐|豆干|tofu|bean curd)/iu;
const MEAT_PATTERN = /(?:肉|牛排|鸡腿|鸡胸|排骨|肉馅|pork|beef|chicken|lamb|steak|sausage|bacon)/iu;
const VEGETABLE_PATTERN =
  /(?:茄子|红椒|青椒|辣椒|蔬菜|洋葱|胡萝卜|芹菜|西葫芦|黄瓜|土豆|番茄|蘑菇|eggplant|pepper|vegetable|onion|carrot|celery|zucchini|cucumber|potato|tomato|mushroom)/iu;

function inferIngredientVariant(text: string): RecipeStepIngredientVariant {
  if (TOFU_PATTERN.test(text)) return "tofu";
  if (MEAT_PATTERN.test(text)) return "meat";
  if (VEGETABLE_PATTERN.test(text)) return "vegetable";
  return "generic";
}

/**
 * Picks a display illustration without changing or normalizing stored recipe data.
 * Explicit action metadata always wins; text is consulted only for legacy steps
 * whose action is absent or recorded as `other`.
 */
export function resolveRecipeStepVisual(
  actionType: RecipeActionType | null | undefined,
  text: string,
): RecipeStepVisual {
  const ingredientVariant = inferIngredientVariant(text);

  if (actionType && actionType !== "other") {
    return { actionType, ingredientVariant };
  }

  const inferredAction = INFERRED_ACTION_PATTERNS.find(({ pattern }) => pattern.test(text));
  return {
    actionType: inferredAction?.actionType ?? "other",
    ingredientVariant,
  };
}
