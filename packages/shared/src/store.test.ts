import { expect, test } from "vitest";
import { getWeeeProductDisplayName } from "./store";

test.each([
  ["weee_seasoning_Lee_Kum_Kee Soy Sauce 500 ml", "Lee Kum Kee Soy Sauce 500 ml"],
  ["weee_dried_茉莉香米 10 lb", "茉莉香米 10 lb"],
  ["WEEE_MEAT_Beef Short Ribs", "Beef Short Ribs"],
  ["weee_health_Organic Tofu", "Organic Tofu"],
  ["weee_green_Bok_Choy", "Bok Choy"],
  ["weee_frozen_Dumplings 20 oz", "Dumplings 20 oz"],
  ["weee_freshgourmet_Seasoned Beef", "Seasoned Beef"],
  ["weee_snack_Rice Crackers", "Rice Crackers"],
  ["weee_instant_Instant Noodles", "Instant Noodles"],
  ["weee_canned_Canned Corn", "Canned Corn"],
  ["weee_care_Hand Soap", "Hand Soap"],
  ["weee_fruits_Fuji Apples", "Fuji Apples"],
  ["weee_tofuplantbased_Firm Tofu", "Firm Tofu"],
  ["weee_grocery_Rice Flour", "Rice Flour"],
])("cleans the recognized leading machine prefix in %s", (source, expected) => {
  expect(getWeeeProductDisplayName(source)).toBe(expected);
});

test.each([
  "Weee! Organic Tofu", "Weee Organics Rice", "weee_brand_Rice", "weee_Rice",
  "Special weee_meat_Beef", "weee_meat_", "weee_dried___", "Lee_Kum_Kee Sauce",
])("preserves brand names, unknown prefixes, and empty remainders: %s", (source) => {
  expect(getWeeeProductDisplayName(source)).toBe(source);
});
