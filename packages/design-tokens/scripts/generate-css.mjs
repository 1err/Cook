import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function cssKey(group, key) {
  return `--cw-${group}-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function cssValue(group, value) {
  if (group === "space" || group === "radius") return `${value}px`;
  if (group === "motion") return `${value}ms`;
  return String(value);
}

export function renderCss(tokens) {
  const lines = [":root {"];
  for (const [group, values] of Object.entries(tokens)) {
    for (const [key, value] of Object.entries(values)) {
      lines.push(`  ${cssKey(group, key)}: ${cssValue(group, value)};`);
    }
  }
  lines.push("}", "");
  return lines.join("\n");
}

async function main() {
  const sourceUrl = new URL("../src/tokens.json", import.meta.url);
  const outputUrl = new URL("../dist/tokens.css", import.meta.url);
  const tokens = JSON.parse(await readFile(sourceUrl, "utf8"));
  await mkdir(dirname(fileURLToPath(outputUrl)), { recursive: true });
  await writeFile(outputUrl, renderCss(tokens), "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
