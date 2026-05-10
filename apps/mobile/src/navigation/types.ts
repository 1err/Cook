import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type LibraryStackParamList = {
  LibraryList: undefined;
  RecipeDetail: { recipeId: string };
  RecipeEdit: { recipeId?: string } | undefined;
  FriendSearch: undefined;
  FriendLibrary: { userId: string; email: string };
};

export type PlannerStackParamList = {
  PlannerWeek: { weekStart?: string } | undefined;
};

export type ShoppingStackParamList = {
  ShoppingList: { weekStart?: string } | undefined;
};

export type ProfileStackParamList = {
  Profile: undefined;
  Settings: undefined;
};

export type MainTabsParamList = {
  Library: NavigatorScreenParams<LibraryStackParamList> | undefined;
  Planner: NavigatorScreenParams<PlannerStackParamList> | undefined;
  Shopping: NavigatorScreenParams<ShoppingStackParamList> | undefined;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  Main: NavigatorScreenParams<MainTabsParamList> | undefined;
  ImportModal: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
