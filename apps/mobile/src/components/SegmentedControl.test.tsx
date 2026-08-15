import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SegmentedControl } from "./SegmentedControl";

test("announces selection and emits the selected language", async () => {
  const onChange = jest.fn();
  await render(
    <SegmentedControl
      label="Language"
      value="en"
      options={[{ value: "en", label: "English" }, { value: "zh", label: "中文" }]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { name: "English" })).toBeSelected();
  fireEvent.press(screen.getByRole("button", { name: "中文" }));
  expect(onChange).toHaveBeenCalledWith("zh");
});
