import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { colors } from "../theme";

export const coreStackScreenOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerLargeTitleShadowVisible: false,
  headerShadowVisible: false,
  headerTransparent: false,
  headerTintColor: colors.terracotta,
  headerStyle: { backgroundColor: colors.surface },
  headerLargeStyle: { backgroundColor: colors.canvas },
  headerTitleStyle: { color: colors.ink, fontFamily: "Inter_600SemiBold" },
  headerLargeTitleStyle: { color: colors.ink, fontFamily: "SourceSerif4_600SemiBold" },
};
