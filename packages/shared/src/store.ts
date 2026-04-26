export type ProductStore = "weee" | "amazon";

export const PRODUCT_STORES = ["weee", "amazon"] as const satisfies readonly ProductStore[];

export const PRODUCT_STORE_LABELS: Record<ProductStore, string> = {
  weee: "Weee",
  amazon: "Amazon",
};
