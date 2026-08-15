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
  const english = screen.getByRole("button", { name: "English" });
  const chinese = screen.getByRole("button", { name: "中文" });
  expect(english).toBeSelected();
  expect(english).toHaveStyle({ minWidth: 44, minHeight: 44 });
  expect(chinese).toHaveStyle({ minWidth: 44, minHeight: 44 });
  await fireEvent.press(chinese);
  expect(onChange).toHaveBeenCalledWith("zh");
});
