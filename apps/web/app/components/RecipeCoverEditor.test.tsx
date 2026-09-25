import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RecipeCoverEditor } from "./RecipeCoverEditor";

const { uploadRecipeImage } = vi.hoisted(() => ({ uploadRecipeImage: vi.fn() }));
vi.mock("../lib/uploadRecipeImage", () => ({ uploadRecipeImage }));
vi.mock("../lib/i18n", () => ({ useT: () => (key: string) => key }));
beforeEach(() => { uploadRecipeImage.mockReset(); });
afterEach(cleanup);
const oldCover = "https://images.example/original.jpg";
const newCover = "https://images.example/new.jpg";
const photo = () => new File(["photo"], "dish.jpg", { type: "image/jpeg" });

test("keeps the current image until upload and save succeed, and reports its entire busy period", async () => {
  let finishUpload!: (url: string) => void;
  let finishSave!: () => void;
  uploadRecipeImage.mockReturnValue(new Promise<string>(resolve => { finishUpload = resolve; }));
  const busy = vi.fn();
  function Harness() {
    const [value, setValue] = useState(oldCover);
    return <RecipeCoverEditor value={value} onBusyChange={busy} onChange={async (url) => {
      await new Promise<void>(resolve => { finishSave = resolve; });
      setValue(url);
    }} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("recipe.coverImage"), { target: { files: [photo()] } });
  expect(screen.getByRole("img")).toHaveAttribute("src", oldCover);
  expect(screen.getByRole("button", { name: "recipe.uploading" })).toBeDisabled();
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => { finishUpload(newCover); });
  expect(screen.getByRole("img")).toHaveAttribute("src", oldCover);
  expect(busy).toHaveBeenLastCalledWith(true);
  await act(async () => { finishSave(); });
  expect(screen.getByRole("img")).toHaveAttribute("src", newCover);
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("status")).toHaveTextContent("recipe.cover.updated");
});

test.each(["upload", "save"])("preserves the existing cover after %s fails and permits retry", async (failure) => {
  uploadRecipeImage.mockImplementation(() => failure === "upload" ? Promise.reject(new Error("Upload failed")) : Promise.resolve(newCover));
  const onChange = vi.fn().mockRejectedValue(new Error("Save failed"));
  render(<RecipeCoverEditor value={oldCover} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("recipe.coverImage"), { target: { files: [photo()] } });
  expect(await screen.findByRole("alert")).toHaveTextContent(failure === "upload" ? "Upload failed" : "Save failed");
  expect(screen.getByRole("img")).toHaveAttribute("src", oldCover);
  expect(screen.getByRole("button", { name: "recipe.cover.change" })).toBeEnabled();
  expect(screen.getByLabelText("recipe.coverImage")).toHaveValue("");
  if (failure === "upload") expect(onChange).not.toHaveBeenCalled();
});

test("rejects unsupported or oversized files without uploading", async () => {
  render(<RecipeCoverEditor value={null} onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("recipe.coverImage"), { target: { files: [new File(["text"], "recipe.pdf", { type: "application/pdf" })] } });
  expect(screen.getByRole("alert")).toHaveTextContent("recipe.cover.invalidFile");
  const large = photo();
  Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText("recipe.coverImage"), { target: { files: [large] } });
  expect(screen.getByRole("alert")).toHaveTextContent("recipe.cover.tooLarge");
  expect(uploadRecipeImage).not.toHaveBeenCalled();
});

test("does not save an upload after navigating away", async () => {
  let finishUpload!: (url: string) => void;
  uploadRecipeImage.mockReturnValue(new Promise<string>(resolve => { finishUpload = resolve; }));
  const onChange = vi.fn();
  const { unmount } = render(<RecipeCoverEditor value={oldCover} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("recipe.coverImage"), { target: { files: [photo()] } });
  unmount();
  await act(async () => { finishUpload(newCover); });
  expect(onChange).not.toHaveBeenCalled();
});

test("uses the latest change handler when other draft fields change during upload", async () => {
  let finishUpload!: (url: string) => void;
  uploadRecipeImage.mockReturnValue(new Promise<string>(resolve => { finishUpload = resolve; }));
  const oldHandler = vi.fn();
  const latestHandler = vi.fn();
  const { rerender } = render(<RecipeCoverEditor value={oldCover} onChange={oldHandler} />);
  fireEvent.change(screen.getByLabelText("recipe.coverImage"), { target: { files: [photo()] } });
  rerender(<RecipeCoverEditor value={oldCover} onChange={latestHandler} />);
  await act(async () => { finishUpload(newCover); });
  await waitFor(() => expect(latestHandler).toHaveBeenCalledWith(newCover));
  expect(oldHandler).not.toHaveBeenCalled();
});
