import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { I18nProvider, useI18n } from "./i18n";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

function Probe() {
  const { setLanguage, t } = useI18n();
  return (
    <>
      <Text>{t("nav.library")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="中文" onPress={() => setLanguage("zh")} />
    </>
  );
}

test("switches and persists the shell language", async () => {
  await render(<I18nProvider><Probe /></I18nProvider>);
  expect(screen.getByText("Library")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "中文" }));
  expect(await screen.findByText("菜谱库")).toBeTruthy();
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith("cooking-ui-language", "zh"));
});
