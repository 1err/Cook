import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { LinkInputForm } from "./LinkInputForm";

test("keeps import hints collapsed until requested", async () => {
  await render(
    <LinkInputForm
      url=""
      onUrlChange={jest.fn()}
      notes=""
      onNotesChange={jest.fn()}
      title=""
      onTitleChange={jest.fn()}
      libraryTags={[]}
      onTagsChange={jest.fn()}
    />,
  );

  expect(screen.getByLabelText("YouTube URL")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Title (optional)")).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Optional details" }));

  expect(screen.getByLabelText("Title (optional)")).toBeOnTheScreen();
  expect(screen.getByLabelText("Notes (optional)")).toBeOnTheScreen();
});
