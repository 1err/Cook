import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { I18nProvider, useI18n } from "./i18n";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

function Probe() {
  const { loading, setLanguage, t } = useI18n();
  return (
    <>
      <Text>{t("nav.library")}</Text>
      <Text>{loading ? "loading" : "ready"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="中文" onPress={() => setLanguage("zh")} />
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("switches and persists the shell language", async () => {
  await render(<I18nProvider><Probe /></I18nProvider>);
  expect(screen.getByText("Library")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "中文" }));
  expect(await screen.findByText("菜谱库")).toBeTruthy();
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith("cooking-ui-language", "zh"));
});

test("does not overwrite an explicit selection when stale hydration finishes", async () => {
  let resolvePersistedLanguage!: (language: string | null) => void;
  const persistedLanguage = new Promise<string | null>((resolve) => {
    resolvePersistedLanguage = resolve;
  });
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => persistedLanguage);

  await render(<I18nProvider><Probe /></I18nProvider>);
  await fireEvent.press(screen.getByRole("button", { name: "中文" }));
  expect(screen.getByText("菜谱库")).toBeTruthy();

  await act(async () => {
    resolvePersistedLanguage("en");
    await persistedLanguage;
  });

  expect(screen.getByText("ready")).toBeTruthy();
  expect(screen.getByText("菜谱库")).toBeTruthy();
});
