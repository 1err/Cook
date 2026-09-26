import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: { email?: string } | undefined;
};

export type LibraryStackParamList = {
  LibraryList: undefined;
  MenuMaker: { recipeIds: string[] };
  RecipeDetail: { recipeId: string };
  RecipeEdit: { recipeId?: string; focus?: "recipe" | "tutorial" } | undefined;
  FriendSearch: undefined;
  FriendLibrary: { userId: string; email: string };
};

export type PlannerStackParamList = {
  PlannerWeek: { weekStart?: string } | undefined;
};

export type ShoppingStackParamList = {
  ShoppingList: { weekStart?: string } | undefined;
};

export type CookStackParamList = {
  CookHome: { dishId?: string } | undefined;
};

export type ProfileStackParamList = {
  Profile: undefined;
  Settings: undefined;
  DesignSystem: undefined;
};

export type MainTabsParamList = {
  Library: NavigatorScreenParams<LibraryStackParamList> | undefined;
  Planner: NavigatorScreenParams<PlannerStackParamList> | undefined;
  Cook: NavigatorScreenParams<CookStackParamList> | undefined;
  Shopping: NavigatorScreenParams<ShoppingStackParamList> | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  VerifyEmail: undefined;
  Main: NavigatorScreenParams<MainTabsParamList> | undefined;
  ImportModal: { initialUrl?: string } | undefined;
  Account: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
