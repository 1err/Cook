import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderCss } from "../scripts/generate-css.mjs";

const tokens = JSON.parse(
  await readFile(new URL("../src/tokens.json", import.meta.url), "utf8"),
);

test("renders stable Warm Modern Editorial CSS properties", () => {
  const css = renderCss(tokens);
  assert.match(css, /--cw-color-canvas: #FBF8F2;/);
  assert.match(css, /--cw-color-ink: #2F2621;/);
  assert.match(css, /--cw-color-action: #A64B34;/);
  assert.match(css, /--cw-space-6: 24px;/);
  assert.match(css, /--cw-radius-modal: 24px;/);
  assert.doesNotMatch(css, /gradient/i);
});
