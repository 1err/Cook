const assert = require("node:assert/strict");
const path = require("path");
const test = require("node:test");

const config = require("./metro.config");

test("Metro watches only mobile dependency roots instead of crawling the repository", () => {
  const workspaceRoot = path.resolve(__dirname, "../..");

  assert.deepEqual(config.watchFolders, [
    path.join(workspaceRoot, "node_modules"),
    path.join(workspaceRoot, "packages/api-client"),
    path.join(workspaceRoot, "packages/design-tokens"),
    path.join(workspaceRoot, "packages/shared"),
  ]);
  assert.ok(!config.watchFolders.includes(workspaceRoot));
});
