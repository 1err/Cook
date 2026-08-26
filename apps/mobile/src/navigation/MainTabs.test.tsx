import { MAIN_TAB_DEFINITIONS } from "./MainTabs";

jest.mock("./stacks/LibraryStack", () => ({ LibraryStack: () => null }));
jest.mock("./stacks/PlannerStack", () => ({ PlannerStack: () => null }));
jest.mock("./stacks/CookStack", () => ({ CookStack: () => null }));
jest.mock("./stacks/ShoppingStack", () => ({ ShoppingStack: () => null }));
jest.mock("../lib/i18n", () => ({ useT: () => (key: string) => key }));

test("keeps Library primary and places Cook between Planner and Shopping", () => {
  expect(MAIN_TAB_DEFINITIONS).toEqual([
    { name: "Library", labelKey: "nav.library", active: "book", inactive: "book-outline" },
    { name: "Planner", labelKey: "nav.planner", active: "calendar", inactive: "calendar-outline" },
    { name: "Cook", labelKey: "nav.cook", active: "restaurant", inactive: "restaurant-outline" },
    { name: "Shopping", labelKey: "nav.shopping", active: "cart", inactive: "cart-outline" },
  ]);
});
