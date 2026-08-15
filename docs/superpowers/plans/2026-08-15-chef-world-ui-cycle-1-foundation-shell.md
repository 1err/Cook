# Chef World UI Cycle 1: Foundation and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Chef World's Warm Modern Editorial design foundation and replace the web and iOS application shells with the approved Library, Planner, Shopping, global Add Recipe, and account navigation.

**Architecture:** A new framework-neutral `@cooking/design-tokens` workspace owns semantic values in JSON, generates web CSS custom properties, and exports typed values to the React Native theme adapter. Web and iOS keep platform-native rendered components, but share token names, icon meanings, state contracts, and bilingual shell copy. Existing feature screens continue to render during this cycle through compatibility aliases; screen-by-screen styling is allocated to the subsequent cycles in the approved specification.

**Tech Stack:** npm workspaces; TypeScript 5; Next.js 14.2 / React 18; Vitest + React Testing Library; Expo SDK 54 / React Native 0.81 / React 19; Jest Expo + React Native Testing Library; Playwright; shared `@cooking/shared` messages.

**Spec:** `docs/superpowers/specs/2026-08-15-chef-world-holistic-ui-redesign-design.md`

## Global Constraints

- Web and iOS are equally important and every task that changes a shared semantic role must verify both consumers.
- Visual identity is Warm Modern Editorial: warm bone canvas, deep ink, restrained terracotta, muted sage, limited elevation, and no gradients or glass effects in new shell code.
- Display and recipe titles use Source Serif 4; controls and body copy use Inter with the approved system fallbacks.
- Library, Planner, and Shopping are the only primary destinations.
- Web exposes one persistent `Add Recipe` header action; iOS exposes one native top-right plus action.
- Account, language, logout, and admin-only tools do not occupy primary navigation.
- New controls meet WCAG 2.2 AA on web and support visible focus, keyboard operation, VoiceOver labels, Dynamic Type, safe areas, and 44-point iOS touch targets.
- Existing import, recipe, planner, shopping, API, and backend behavior remains unchanged in Cycle 1.
- `backend/.venv_fresh/` is unrelated local state and must never be staged.

## Scope Boundary and Cycle Allocation

This is the executable plan for Cycle 1 only. It produces a working, testable foundation and shell on both platforms.

- Cycle 2 owns library masonry, recipe detail, import/editor presentation, the web `from`-query cancel/return behavior, natural-ratio image primitives, and the web post-save route to recipe detail.
- Cycle 3 owns Planner screen composition and interaction styling.
- Cycle 4 owns Shopping screen composition and all product-result presentation states.
- Cycle 5 owns authentication, settings, admin screen finishing, removal of obsolete CSS and duplicate files, and the final cross-product accessibility/localization audit.
- Scraper reliability remains a separate backend project.

## File Structure

### Shared token package

- Create `packages/design-tokens/package.json` — workspace entry points and scripts.
- Create `packages/design-tokens/tsconfig.json` — strict typed JSON exports.
- Create `packages/design-tokens/src/tokens.json` — single token source of truth.
- Create `packages/design-tokens/src/index.ts` — typed mobile/TypeScript exports.
- Create `packages/design-tokens/scripts/generate-css.mjs` — deterministic CSS generator.
- Create `packages/design-tokens/test/generate-css.test.mjs` — generator contract.
- Generate and commit `packages/design-tokens/dist/tokens.css` — web-consumable custom properties.

### Web foundation and shell

- Create `apps/web/vitest.config.ts` and `apps/web/test/setup.ts` — component-test harness.
- Create `apps/web/app/styles/foundation.css` — reset, typography, focus, and reduced-motion rules for migrated components.
- Create `apps/web/app/components/ui/Icon.tsx`, `Button.tsx`, `IconButton.tsx`, and CSS modules — shell primitives.
- Create `apps/web/app/components/LanguageControl.tsx` — compact bilingual selector used by account/auth surfaces.
- Create `apps/web/app/components/AccountMenu.tsx` and CSS module — account, settings, language, admin, and logout menu.
- Rewrite `apps/web/app/components/Header.tsx` and add `Header.module.css` — approved information architecture.
- Delete `apps/web/app/components/NavAuth.tsx` after its behavior is absorbed into `Header` and `AccountMenu`.
- Modify `apps/web/app/layout.tsx`, `apps/web/app/lib/i18n.tsx`, and shared messages — fonts, metadata, language placement, and shell copy.
- Create colocated tests for every new interactive web component.

### iOS foundation and shell

- Create `apps/mobile/src/lib/i18n.tsx` — persisted bilingual message provider.
- Create `apps/mobile/src/components/CoreHeaderActions.tsx` — account avatar plus global Add Recipe action.
- Create `apps/mobile/src/navigation/stacks/AccountStack.tsx` — account flow outside primary tabs.
- Modify the existing theme modules as compatibility adapters over `@cooking/design-tokens`.
- Modify `App.tsx`, `RootStack.tsx`, `MainTabs.tsx`, navigation types, three core stacks, and `ProfileScreen.tsx`.
- Delete `apps/mobile/src/navigation/stacks/ProfileStack.tsx` after `AccountStack.tsx` replaces it.
- Add Jest Expo tests beside the new provider, primitives, and navigation components.

### Verification

- Create `apps/web/playwright.config.ts` and `apps/web/e2e/shell.spec.ts` — responsive shell screenshots and axe checks.
- Create `.github/workflows/frontend-ui.yml` — token, web, and mobile checks.
- Create `docs/qa/2026-08-15-ui-cycle-1-checklist.md` — iOS simulator and bilingual manual verification record.

## Task 1: Create the shared semantic token package

**Files:**
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/tsconfig.json`
- Create: `packages/design-tokens/src/tokens.json`
- Create: `packages/design-tokens/src/index.ts`
- Create: `packages/design-tokens/scripts/generate-css.mjs`
- Test: `packages/design-tokens/test/generate-css.test.mjs`
- Generate: `packages/design-tokens/dist/tokens.css`
- Modify: `package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/mobile/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `designTokens`, `colors`, `spacing`, `radii`, `typography`, and `motion` typed exports.
- Produces: `@cooking/design-tokens/tokens.css` containing `--cw-*` custom properties.
- Consumed by: Tasks 2 through 6.

- [ ] **Step 1: Write the failing CSS-generation contract**

```js
// packages/design-tokens/test/generate-css.test.mjs
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
```

- [ ] **Step 2: Run the contract and confirm the missing-module failure**

Run: `node --test packages/design-tokens/test/generate-css.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `generate-css.mjs` or `tokens.json`.

- [ ] **Step 3: Add the exact semantic source values**

```json
{
  "color": {
    "canvas": "#FBF8F2",
    "surface": "#FFFFFF",
    "subtleSurface": "#F3ECE4",
    "ink": "#2F2621",
    "mutedInk": "#6F6259",
    "action": "#A64B34",
    "actionPressed": "#8F3E2B",
    "sage": "#687761",
    "divider": "#E6DED6",
    "error": "#B42318",
    "success": "#3F6B4A",
    "onAction": "#FFFFFF"
  },
  "space": { "1": 4, "2": 8, "3": 12, "4": 16, "6": 24, "8": 32, "10": 40, "14": 56, "18": 72 },
  "radius": { "control": 8, "field": 12, "card": 16, "modal": 24, "round": 9999 },
  "type": {
    "displayFamily": "Source Serif 4",
    "uiFamily": "Inter",
    "displayFallback": "Iowan Old Style, Songti SC, ui-serif, Georgia, serif",
    "uiFallback": "SF Pro Text, PingFang SC, system-ui, sans-serif"
  },
  "motion": { "fastMs": 120, "standardMs": 180 },
  "elevation": {
    "raised": "0 1px 2px rgba(47, 38, 33, 0.08)",
    "overlay": "0 12px 32px rgba(47, 38, 33, 0.12)",
    "modal": "0 24px 64px rgba(47, 38, 33, 0.16)"
  }
}
```

Create `packages/design-tokens/src/index.ts` with typed aliases:

```ts
import designTokensJson from "./tokens.json";

export const designTokens = designTokensJson;
export const colors = designTokens.color;
export const spacing = designTokens.space;
export const radii = designTokens.radius;
export const typography = designTokens.type;
export const motion = designTokens.motion;
export const elevation = designTokens.elevation;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radii;
```

- [ ] **Step 4: Implement deterministic CSS generation and package exports**

```js
// packages/design-tokens/scripts/generate-css.mjs
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
```

Use this package manifest:

```json
{
  "name": "@cooking/design-tokens",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./dist/tokens.css"
  },
  "scripts": {
    "build": "node scripts/generate-css.mjs",
    "test": "node --test test/*.test.mjs"
  }
}
```

Use this package TypeScript configuration:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Add `@cooking/design-tokens: "file:../../packages/design-tokens"` to both app dependency objects. Add root scripts `tokens:build` and `tokens:test`, then run `npm install` and `npm run tokens:build`.

- [ ] **Step 5: Verify package output and both TypeScript consumers can resolve it**

Run:

```bash
npm run tokens:test
npm run tokens:build
git diff --exit-code packages/design-tokens/dist/tokens.css
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
```

Expected: token test passes, rebuilding creates no diff, and both type checks exit 0.

- [ ] **Step 6: Commit the shared contract**

```bash
git add package.json package-lock.json apps/web/package.json apps/mobile/package.json packages/design-tokens
git commit -m "feat(ui): add shared semantic design tokens"
```

## Task 2: Establish web component tests and shell primitives

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/test/setup.ts`
- Create: `apps/web/app/components/ui/Icon.tsx`
- Create: `apps/web/app/components/ui/Button.tsx`
- Create: `apps/web/app/components/ui/Button.module.css`
- Create: `apps/web/app/components/ui/IconButton.tsx`
- Create: `apps/web/app/components/ui/IconButton.module.css`
- Test: `apps/web/app/components/ui/Button.test.tsx`
- Test: `apps/web/app/components/ui/IconButton.test.tsx`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `@cooking/design-tokens/tokens.css` from Task 1 through the root layout in Task 3.
- Produces: `IconName`, `Icon`, `Button`, `ActionLink`, and `IconButton` for the web shell.

- [ ] **Step 1: Install and configure the official Next.js Vitest stack**

Run:

```bash
npm install --workspace @cooking/web --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Create this config and setup:

```ts
// apps/web/vitest.config.ts
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"], css: true },
});
```

```ts
// apps/web/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

Add `"test": "vitest run"` and `"test:watch": "vitest"` to the web scripts.

- [ ] **Step 2: Write failing behavior tests for the two control primitives**

```tsx
// apps/web/app/components/ui/Button.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Button } from "./Button";

test("announces loading and prevents duplicate activation", async () => {
  const onClick = vi.fn();
  render(<Button loading onClick={onClick}>Save recipe</Button>);
  const button = screen.getByRole("button", { name: "Save recipe" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
});
```

```tsx
// apps/web/app/components/ui/IconButton.test.tsx
import { render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton";

test("requires a readable accessible name", () => {
  render(<IconButton icon="add" label="Add recipe" onClick={() => undefined} />);
  expect(screen.getByRole("button", { name: "Add recipe" })).toBeVisible();
});
```

- [ ] **Step 3: Run the tests and confirm missing-component failures**

Run: `npm --workspace @cooking/web test -- app/components/ui/Button.test.tsx app/components/ui/IconButton.test.tsx`

Expected: FAIL because `Button.tsx` and `IconButton.tsx` do not exist.

- [ ] **Step 4: Implement exact primitive interfaces and icon meanings**

```tsx
// Icon.tsx public contract and fixed symbol map
import type { ReactNode } from "react";

export type IconName =
  | "add" | "menu" | "close" | "account" | "settings"
  | "language" | "logout" | "admin" | "chevronDown";

export type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

const SYMBOLS: Record<IconName, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  account: <><circle cx="12" cy="8" r="3.25" /><path d="M5.5 19c.8-3.5 3-5.25 6.5-5.25S17.7 15.5 18.5 19" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.75v2.1M12 19.15v2.1M2.75 12h2.1M19.15 12h2.1M5.46 5.46l1.48 1.48M17.06 17.06l1.48 1.48M18.54 5.46l-1.48 1.48M6.94 17.06l-1.48 1.48" /></>,
  language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.25 2.45 3.4 5.45 3.4 9S14.25 18.55 12 21M12 3C9.75 5.45 8.6 8.45 8.6 12s1.15 6.55 3.4 9" /></>,
  logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></>,
  admin: <><path d="M12 3l7 3v5c0 4.6-2.3 7.6-7 10-4.7-2.4-7-5.4-7-10V6l7-3Z" /><path d="M9.5 12l1.7 1.7 3.6-3.7" /></>,
  chevronDown: <path d="m7 9.5 5 5 5-5" />,
};
```

`Icon` renders `SYMBOLS[name]` inside one `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">` with `stroke="currentColor"`, `strokeWidth={1.8}`, and rounded caps/joins. It must not use an icon font.

```tsx
// Button.tsx public contract
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leadingIcon?: IconName;
};

type ActionLinkProps = React.ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  leadingIcon?: IconName;
  className?: string;
};
```

`Button` sets `disabled={disabled || loading}`, `aria-busy={loading || undefined}`, retains the visible label during loading, and displays a decorative spinner before it. `ActionLink` applies the same visual variants without pretending links can be disabled. `IconButton` accepts `{ icon, label, onClick, disabled?, pressed?, className? }`, sets `aria-label`, `aria-pressed` only when supplied, and has a 44-by-44-pixel target.

In both CSS modules, use only `--cw-*` tokens. Primary controls use `--cw-color-action`; hover/pressed use `--cw-color-action-pressed`; focus uses a 3-pixel outline with 2-pixel offset; disabled controls retain at least 0.55 opacity. Do not add gradients, backdrop filters, or radii above `--cw-radius-card`.

- [ ] **Step 5: Verify primitive behavior, CSS constraints, and web compilation**

Run:

```bash
npm --workspace @cooking/web test -- app/components/ui/Button.test.tsx app/components/ui/IconButton.test.tsx
rg -n "gradient|backdrop-filter|border-radius:.*999" apps/web/app/components/ui && exit 1 || true
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: both tests pass, the disallowed-style scan prints nothing, and TypeScript exits 0.

- [ ] **Step 6: Commit the web primitives**

```bash
git add apps/web/package.json package-lock.json apps/web/vitest.config.ts apps/web/test apps/web/app/components/ui
git commit -m "feat(web): add tested editorial shell primitives"
```

## Task 3: Replace the web shell and account navigation

**Files:**
- Create: `apps/web/app/styles/foundation.css`
- Create: `apps/web/app/components/LanguageControl.tsx`
- Create: `apps/web/app/components/LanguageControl.module.css`
- Create: `apps/web/app/components/AccountMenu.tsx`
- Create: `apps/web/app/components/AccountMenu.module.css`
- Create: `apps/web/app/components/Header.module.css`
- Test: `apps/web/app/components/Header.test.tsx`
- Test: `apps/web/app/components/AccountMenu.test.tsx`
- Modify: `apps/web/app/components/Header.tsx`
- Modify: `apps/web/app/components/AuthShell.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/lib/i18n.tsx`
- Modify: `packages/shared/src/messages/en.json`
- Modify: `packages/shared/src/messages/zh.json`
- Delete: `apps/web/app/components/NavAuth.tsx`

**Interfaces:**
- Consumes: Task 2 web primitives and existing `useAuth`, `useI18n`, `usePathname`, and `isAdminUser`.
- Produces: one responsive authenticated shell with `Library`, `Planner`, `Shopping`, `Add Recipe`, and account access.

- [ ] **Step 1: Add bilingual shell keys before rendering them**

Add these exact pairs to the English and Chinese message files:

```json
{
  "nav.appName": "Chef World",
  "nav.shopping": "Shopping",
  "nav.addRecipe": "Add Recipe",
  "nav.settings": "Settings",
  "nav.adminTools": "Admin tools",
  "nav.designSystem": "Design system",
  "nav.cachePreview": "Store cache",
  "nav.accountFor": "Account for {email}",
  "nav.findFriend": "Find a friend",
  "account.shareLibrary": "Share my library",
  "account.shareLibraryDescription": "Anyone who knows your email can browse and copy your recipes.",
  "account.language": "Language",
  "account.signOut": "Sign out",
  "account.signOutConfirmTitle": "Sign out?",
  "account.signOutConfirmBody": "You'll need to sign back in to access your library.",
  "account.updateFailed": "Couldn't update. Please try again.",
  "account.close": "Close account",
  "language.english": "English",
  "language.chinese": "中文"
}
```

```json
{
  "nav.appName": "Chef World",
  "nav.shopping": "购物",
  "nav.addRecipe": "添加菜谱",
  "nav.settings": "设置",
  "nav.adminTools": "管理员工具",
  "nav.designSystem": "设计系统",
  "nav.cachePreview": "商店缓存",
  "nav.accountFor": "{email} 的账户",
  "nav.findFriend": "查找朋友",
  "account.shareLibrary": "共享我的菜谱库",
  "account.shareLibraryDescription": "知道你邮箱的人可以浏览并复制你的菜谱。",
  "account.language": "语言",
  "account.signOut": "退出登录",
  "account.signOutConfirmTitle": "要退出登录吗？",
  "account.signOutConfirmBody": "你需要重新登录才能访问菜谱库。",
  "account.updateFailed": "无法更新，请重试。",
  "account.close": "关闭账户页面",
  "language.english": "English",
  "language.chinese": "中文"
}
```

Replace the existing values for `nav.appName`; add the other keys once without duplicating JSON properties.

- [ ] **Step 2: Write failing shell and account-menu tests**

Mock `usePathname`, `useAuth`, and `useI18n` at module scope. Render the admin user on `/planner` and assert this exact contract:

```tsx
expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute("aria-current", "page");
expect(screen.getByRole("link", { name: "Shopping" })).toHaveAttribute("href", "/shopping-list");
expect(screen.getByRole("link", { name: "Add Recipe" })).toHaveAttribute("href", "/import?from=%2Fplanner");
expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
```

Click the account button, then assert `Settings`, the English/Chinese language control, `Store cache`, and `Log out`. In a second test, render a non-admin user and assert `Store cache` is absent. In a third test, press Escape and assert the open menu closes.

- [ ] **Step 3: Run the shell tests and confirm the old information architecture fails**

Run: `npm --workspace @cooking/web test -- app/components/Header.test.tsx app/components/AccountMenu.test.tsx`

Expected: FAIL because Import is still primary navigation and account/language/admin behavior is split across components.

- [ ] **Step 4: Implement the web foundation and root font variables**

At the top of `layout.tsx`, import token CSS, foundation CSS, and Next font loaders:

```tsx
import "@cooking/design-tokens/tokens.css";
import "./globals.css";
import "./styles/foundation.css";
import { Inter, Source_Serif_4 } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--cw-font-ui-loaded" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--cw-font-display-loaded" });
```

Set `<html lang="en" className={`${inter.variable} ${sourceSerif.variable}`}>`, keep the existing Material Symbols `<link>` temporarily because legacy feature screens still consume it, ensure every new shell component uses Task 2 inline SVG icons, remove the global `<LanguageToggle />`, and set metadata title to `Chef World — Recipe library & planner`.

Use this narrowly scoped foundation; it does not override feature-specific selectors from `globals.css`:

```css
body {
  background: var(--cw-color-canvas);
  color: var(--cw-color-ink);
  font-family: var(--cw-font-ui-loaded), Inter, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
}

.cw-display {
  font-family: var(--cw-font-display-loaded), "Source Serif 4", "Iowan Old Style", "Songti SC", ui-serif, Georgia, serif;
  font-weight: 600;
}

::selection {
  background: color-mix(in srgb, var(--cw-color-action) 20%, transparent);
}

:focus-visible {
  outline: 3px solid var(--cw-color-action);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 5: Implement language, account, and header composition**

`LanguageControl` consumes `{ compact?: boolean }` plus `useI18n()`, renders two real buttons, and exposes `aria-pressed`. Remove the exported `LanguageToggle` function from `lib/i18n.tsx`; keep the provider, storage key, interpolation, `useI18n`, and `useT` unchanged. Render `<LanguageControl compact />` at the top-right of the `AuthShell` panel so login and registration retain language access after the global fixed toggle is removed.

`AccountMenu` consumes this exact interface:

```ts
type AccountMenuProps = {
  email: string;
  isAdmin: boolean;
  onLogout: () => Promise<void>;
};
```

It uses an initial avatar button, closes on outside click, Escape, and route-link activation, restores focus to the avatar on Escape, and renders Settings, `LanguageControl`, admin-only `/preview`, and logout. It uses semantic menu/list markup without assigning `menuitem` to interactive descendants that already have correct link/button semantics.

`Header` must use this route model:

```ts
const PRIMARY_LINKS = [
  { href: "/library", key: "nav.library" },
  { href: "/planner", key: "nav.planner" },
  { href: "/shopping-list", key: "nav.shopping" },
] as const;

const addRecipeHref = `/import?from=${encodeURIComponent(pathname)}`;
```

The desktop order is brand, three primary links, Add Recipe, account. The narrow layout retains Add Recipe and account in the top row and places only the three primary links in the collapsible menu. While authentication loads, reserve one 44-pixel account slot with an `aria-hidden` skeleton to prevent layout shift. Active routes use `aria-current="page"`; nested Library routes keep Library active. Login/register continue to hide the authenticated shell, and unauthenticated non-auth routes keep Sign in/Register actions.

Use CSS modules and `--cw-*` values. The header is opaque `--cw-color-canvas` with a divider, not blurred glass. The active state uses text weight plus a 2-pixel terracotta underline. The Add Recipe link uses the primary `ActionLink` and never coexists with a floating persistent add button.

- [ ] **Step 6: Verify web shell behavior and compile the production build**

Run:

```bash
npm --workspace @cooking/web test -- app/components
npm run web:build
rg -n "href=\"/import\".*headerNavLink|nav\.preview.*headerNavLink" apps/web/app/components && exit 1 || true
```

Expected: component tests pass, production build exits 0, and the old Import/admin primary-link patterns are absent.

- [ ] **Step 7: Commit the web shell**

```bash
git add apps/web/app/layout.tsx apps/web/app/styles apps/web/app/components apps/web/app/lib/i18n.tsx packages/shared/src/messages/en.json packages/shared/src/messages/zh.json
git commit -m "feat(web): replace navigation with editorial app shell"
```

## Task 4: Establish the iOS token, font, i18n, and component-test foundation

**Files:**
- Create: `apps/mobile/src/lib/i18n.tsx`
- Test: `apps/mobile/src/lib/i18n.test.tsx`
- Test: `apps/mobile/src/components/Button.test.tsx`
- Test: `apps/mobile/src/components/IconButton.test.tsx`
- Create: `apps/mobile/src/components/SegmentedControl.tsx`
- Test: `apps/mobile/src/components/SegmentedControl.test.tsx`
- Modify: `apps/mobile/App.tsx`
- Modify: `apps/mobile/src/theme/colors.ts`
- Modify: `apps/mobile/src/theme/spacing.ts`
- Modify: `apps/mobile/src/theme/radii.ts`
- Modify: `apps/mobile/src/theme/typography.ts`
- Modify: `apps/mobile/src/theme/index.ts`
- Modify: `apps/mobile/src/components/Button.tsx`
- Modify: `apps/mobile/src/components/IconButton.tsx`
- Modify: `apps/mobile/src/components/index.ts`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/tsconfig.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 1 token exports and shared `MESSAGE_MAP`.
- Produces: mobile `I18nProvider`, `useI18n`, `useT`, compatibility theme aliases, loaded font families, and tested 44-point controls.
- Produces: `SegmentedControl<T extends string>` for the account language selector.

- [ ] **Step 1: Install Expo-compatible test and font packages**

Run from `apps/mobile`:

```bash
npx expo install @expo-google-fonts/inter @expo-google-fonts/source-serif-4 expo-font
npx expo install jest-expo jest @types/jest @testing-library/react-native -- --dev
```

Confirm the three font packages are under `dependencies`. Add `"test": "jest --runInBand"` and this Jest configuration:

```json
{
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@react-navigation/.*|@gorhom/.*|react-native-reanimated|react-native-worklets)"
  ]
}
```

Add `"types": ["jest"]` under mobile `compilerOptions`.

- [ ] **Step 2: Write failing mobile foundation tests**

```tsx
// apps/mobile/src/lib/i18n.test.tsx
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
  render(<I18nProvider><Probe /></I18nProvider>);
  expect(screen.getByText("Library")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "中文" }));
  expect(await screen.findByText("菜谱库")).toBeTruthy();
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith("cooking-ui-language", "zh"));
});
```

```tsx
// apps/mobile/src/components/Button.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./Button";

test("announces loading and blocks duplicate presses", () => {
  const onPress = jest.fn();
  render(<Button title="Save recipe" loading onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Save recipe" });
  expect(button).toHaveAccessibilityState({ busy: true, disabled: true });
  fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});
```

```tsx
// apps/mobile/src/components/IconButton.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { IconButton } from "./IconButton";

test("provides a named 44-point touch target", () => {
  const onPress = jest.fn();
  render(<IconButton icon="add" accessibilityLabel="Add recipe" onPress={onPress} />);
  const button = screen.getByRole("button", { name: "Add recipe" });
  expect(button).toHaveStyle({ minWidth: 44, minHeight: 44 });
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
```

```tsx
// apps/mobile/src/components/SegmentedControl.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SegmentedControl } from "./SegmentedControl";

test("announces selection and emits the selected language", () => {
  const onChange = jest.fn();
  render(
    <SegmentedControl
      label="Language"
      value="en"
      options={[{ value: "en", label: "English" }, { value: "zh", label: "中文" }]}
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("button", { name: "English" })).toHaveAccessibilityState({ selected: true });
  fireEvent.press(screen.getByRole("button", { name: "中文" }));
  expect(onChange).toHaveBeenCalledWith("zh");
});
```

- [ ] **Step 3: Run Jest and confirm the provider and touch-target failures**

Run: `npm --workspace @cooking/mobile test -- --runTestsByPath src/lib/i18n.test.tsx src/components/Button.test.tsx src/components/IconButton.test.tsx src/components/SegmentedControl.test.tsx`

Expected: FAIL because mobile i18n and `SegmentedControl` do not exist and `IconButton` does not guarantee a 44-point layout target.

- [ ] **Step 4: Adapt the mobile theme without breaking existing screens**

Map new roles from `@cooking/design-tokens`, then retain explicit compatibility aliases:

```ts
import { colors as sharedColors } from "@cooking/design-tokens";

export const colors = {
  canvas: sharedColors.canvas,
  surface: sharedColors.surface,
  subtleSurface: sharedColors.subtleSurface,
  ink: sharedColors.ink,
  mutedInk: sharedColors.mutedInk,
  terracotta: sharedColors.action,
  terracottaPressed: sharedColors.actionPressed,
  sage: sharedColors.sage,
  divider: sharedColors.divider,
  error: sharedColors.error,
  success: sharedColors.success,
  onAction: sharedColors.onAction,
  primary: sharedColors.action,
  primaryContainer: sharedColors.subtleSurface,
  primaryFixed: sharedColors.subtleSurface,
  onPrimaryFixed: sharedColors.actionPressed,
  onPrimary: sharedColors.onAction,
  background: sharedColors.canvas,
  surfaceContainerLow: sharedColors.subtleSurface,
  surfaceContainer: sharedColors.subtleSurface,
  surfaceContainerHigh: sharedColors.divider,
  white: sharedColors.surface,
  onSurface: sharedColors.ink,
  onSurfaceVariant: sharedColors.mutedInk,
  border: sharedColors.divider,
  errorContainer: "#FEE4E2",
  onError: sharedColors.onAction,
  successContainer: "#E8F1E8",
  onSuccess: sharedColors.success,
  recipePaper: sharedColors.canvas,
  recipeCard: sharedColors.surface,
  recipeLine: sharedColors.divider,
  accentSoft: sharedColors.subtleSurface,
  accent: sharedColors.action,
  tipsCallout: sharedColors.subtleSurface,
} as const;
```

Map existing spacing/radius keys with these compatibility adapters:

```ts
import { spacing as sharedSpacing } from "@cooking/design-tokens";
export const spacing = {
  xs: sharedSpacing["1"], sm: sharedSpacing["2"], md: sharedSpacing["3"],
  lg: sharedSpacing["4"], xl: sharedSpacing["6"], "2xl": sharedSpacing["8"],
  "3xl": sharedSpacing["10"], "4xl": sharedSpacing["14"], "5xl": sharedSpacing["18"],
} as const;
```

```ts
import { radii as sharedRadii } from "@cooking/design-tokens";
export const radii = {
  sm: sharedRadii.control, md: sharedRadii.field, lg: sharedRadii.card,
  xl: sharedRadii.modal, full: sharedRadii.round,
} as const;
```

Typography uses these exact loaded families and does not combine a custom weighted family with a conflicting `fontWeight`:

```ts
export const typography = {
  largeTitle: { fontSize: 34, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.2 },
  title1: { fontSize: 28, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.1 },
  recipeTitle: { fontSize: 28, fontFamily: "SourceSerif4_600SemiBold", letterSpacing: 0.1 },
  title2: { fontSize: 22, fontFamily: "SourceSerif4_600SemiBold" },
  title3: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  headline: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 17, fontFamily: "Inter_400Regular" },
  callout: { fontSize: 16, fontFamily: "Inter_400Regular" },
  subhead: { fontSize: 15, fontFamily: "Inter_400Regular" },
  footnote: { fontSize: 13, fontFamily: "Inter_400Regular" },
  caption: { fontSize: 12, fontFamily: "Inter_400Regular" },
} satisfies Record<string, TextStyle>;
```

- [ ] **Step 5: Implement persisted mobile i18n and font loading**

`i18n.tsx` mirrors the web provider contract, reads/writes `cooking-ui-language` through AsyncStorage, interpolates `{variable}` placeholders, sets English until persisted state loads, and exposes `{ language, setLanguage, t, loading }`.

In `App.tsx`, import `useFonts` from `expo-font`, plus `Inter_400Regular`, `Inter_600SemiBold`, `Inter_700Bold`, `SourceSerif4_400Regular`, and `SourceSerif4_600SemiBold` from their Expo font packages. Load exactly those five values:

```tsx
const [fontsLoaded] = useFonts({
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
});
```

Render the existing warm splash gate until fonts are loaded, then wrap `AuthProvider` and `RootStack` in `I18nProvider`. Keep Gesture Handler, Safe Area, Bottom Sheet, and StatusBar provider ordering intact.

Update Button and IconButton to consume new semantic roles. While loading, Button retains its visible title next to the activity indicator so its accessible name and bounds remain stable. `IconButton` uses a 44-by-44 minimum target, centers the glyph, reports disabled state, and keeps hit slop only as an additional convenience.

Implement `SegmentedControl` with this contract:

```ts
type SegmentedOption<T extends string> = { value: T; label: string };
type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
};
```

It renders one labeled horizontal group and one 44-point Pressable per option. Each option exposes `accessibilityRole="button"` and `accessibilityState={{ selected }}`; selected state uses ink-on-subtle-surface plus a terracotta 1-point border, while unselected state uses muted ink and a transparent border.

Export `SegmentedControl` and its public prop types from `apps/mobile/src/components/index.ts`.

- [ ] **Step 6: Verify Jest, TypeScript, and hardcoded-color boundaries**

Run:

```bash
npm --workspace @cooking/mobile test
npx tsc -p apps/mobile/tsconfig.json --noEmit
rg -n '#[0-9A-Fa-f]{6}' apps/mobile/src/components apps/mobile/src/navigation | grep -v 'theme/' && exit 1 || true
```

Expected: tests and type check pass; migrated components/navigation contain no raw six-digit hex values.

- [ ] **Step 7: Commit the iOS foundation**

```bash
git add apps/mobile package-lock.json
git commit -m "feat(ios): add editorial theme and test foundation"
```

## Task 5: Replace iOS primary navigation and add global header actions

**Files:**
- Create: `apps/mobile/src/components/CoreHeaderActions.tsx`
- Test: `apps/mobile/src/components/CoreHeaderActions.test.tsx`
- Test: `apps/mobile/src/navigation/MainTabs.test.tsx`
- Create: `apps/mobile/src/navigation/coreStackOptions.ts`
- Create: `apps/mobile/src/navigation/stacks/AccountStack.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/MainTabs.tsx`
- Modify: `apps/mobile/src/navigation/RootStack.tsx`
- Modify: `apps/mobile/src/navigation/stacks/LibraryStack.tsx`
- Modify: `apps/mobile/src/navigation/stacks/PlannerStack.tsx`
- Modify: `apps/mobile/src/navigation/stacks/ShoppingStack.tsx`
- Modify: `apps/mobile/src/features/library/LibraryListScreen.tsx`
- Modify: `apps/mobile/src/features/profile/ProfileScreen.tsx`
- Modify: `apps/mobile/src/features/profile/SettingsScreen.tsx`
- Delete: `apps/mobile/src/navigation/stacks/ProfileStack.tsx`

**Interfaces:**
- Consumes: Task 4 theme, `useT`, `useAuth`, `IconButton`, and existing `ImportModal`.
- Produces: `CoreHeaderActions({ before? })`, three primary tabs, root Account modal, and bilingual account/language controls.

- [ ] **Step 1: Write failing navigation and action tests**

```tsx
// apps/mobile/src/components/CoreHeaderActions.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { IconButton } from "./IconButton";
import { CoreHeaderActions } from "./CoreHeaderActions";

const navigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ user: { email: "jerry@example.com" } }) }));
jest.mock("../lib/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) => {
    if (key === "nav.addRecipe") return "Add recipe";
    if (key === "nav.accountFor") return `Account for ${vars?.email ?? ""}`;
    return key;
  },
}));

beforeEach(() => navigate.mockClear());

test("orders contextual, account, and add actions and opens root flows", () => {
  render(
    <CoreHeaderActions before={<IconButton icon="search" accessibilityLabel="Find a friend" onPress={() => undefined} />} />,
  );
  expect(screen.getAllByRole("button").map((node) => node.props.accessibilityLabel)).toEqual([
    "Find a friend",
    "Account for jerry@example.com",
    "Add recipe",
  ]);
  fireEvent.press(screen.getByRole("button", { name: "Account for jerry@example.com" }));
  fireEvent.press(screen.getByRole("button", { name: "Add recipe" }));
  expect(navigate).toHaveBeenNthCalledWith(1, "Account");
  expect(navigate).toHaveBeenNthCalledWith(2, "ImportModal");
});
```

Add a pure exported `MAIN_TAB_DEFINITIONS` test that expects exactly:

```ts
// apps/mobile/src/navigation/MainTabs.test.tsx
import { MAIN_TAB_DEFINITIONS } from "./MainTabs";

test("keeps account outside the three primary tabs", () => {
  expect(MAIN_TAB_DEFINITIONS).toEqual(
[
  { name: "Library", labelKey: "nav.library", active: "book", inactive: "book-outline" },
  { name: "Planner", labelKey: "nav.planner", active: "calendar", inactive: "calendar-outline" },
  { name: "Shopping", labelKey: "nav.shopping", active: "cart", inactive: "cart-outline" },
]);
});
```

Assert there is no `ProfileTab` definition.

- [ ] **Step 2: Run the focused tests and confirm old tab architecture fails**

Run: `npm --workspace @cooking/mobile test -- --runTestsByPath src/components/CoreHeaderActions.test.tsx src/navigation/MainTabs.test.tsx`

Expected: FAIL because `CoreHeaderActions`, `MAIN_TAB_DEFINITIONS`, and the three-tab contract do not exist.

- [ ] **Step 3: Move account navigation to the root stack**

Change the navigation types to:

```ts
export type MainTabsParamList = {
  Library: NavigatorScreenParams<LibraryStackParamList> | undefined;
  Planner: NavigatorScreenParams<PlannerStackParamList> | undefined;
  Shopping: NavigatorScreenParams<ShoppingStackParamList> | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  Main: NavigatorScreenParams<MainTabsParamList> | undefined;
  ImportModal: undefined;
  Account: NavigatorScreenParams<ProfileStackParamList> | undefined;
};
```

Rename the rendered stack module to `AccountStack`, keep `ProfileStackParamList` for screen compatibility, and register `Account` in `RootStack` with `presentation: "modal"` and `headerShown: false`. Delete `ProfileTab` from `MainTabs` and use `useT()` for tab labels.

- [ ] **Step 4: Implement one shared native header-action group**

```ts
type CoreHeaderActionsProps = {
  before?: React.ReactNode;
};
```

The component reads the authenticated email, uses `Array.from(email)[0]?.toUpperCase() ?? "?"` for a 32-point avatar, and renders `before`, account, then add inside a horizontal view. Its account label is `t("nav.accountFor", { email })`; the add label is `t("nav.addRecipe")`. Account calls `navigation.navigate("Account")`; add calls `navigation.navigate("ImportModal")`. Both actions use 44-point controls and translated accessibility labels.

Set `headerRight: () => <CoreHeaderActions />` on the Planner and Shopping root screens. The Library root screen uses this exact contextual action before the shared controls:

```tsx
headerRight: () => (
  <CoreHeaderActions
    before={
      <IconButton
        icon="search"
        accessibilityLabel={t("nav.findFriend")}
        onPress={() => navigation.navigate("FriendSearch")}
      />
    }
  />
)
```

Remove the locally rendered plus button and duplicated `headerActions` styles from `LibraryListScreen`.

- [ ] **Step 5: Make account and language reachable without a fourth tab**

Update `ProfileScreen` to show identity, the existing library-sharing switch, Settings, and this language control:

```tsx
const { language, setLanguage } = useI18n();
<SegmentedControl
  label={t("account.language")}
  value={language}
  options={[
    { value: "en", label: t("language.english") },
    { value: "zh", label: t("language.chinese") },
  ]}
  onChange={setLanguage}
/>
```

Add a close action supplied by the modal navigation bar. `SettingsScreen` keeps the existing server-backed sign-out behavior and uses `account.signOutConfirmTitle`, `account.signOutConfirmBody`, `common.cancel`, and `account.signOut`. Both screens use `useT()` for all shell/account strings; feature copy migration remains with Cycle 5.

All three core stacks share this object from `apps/mobile/src/navigation/coreStackOptions.ts`:

```ts
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
```

- [ ] **Step 6: Verify the navigation contract and compile iOS JavaScript**

Run:

```bash
npm --workspace @cooking/mobile test
npx tsc -p apps/mobile/tsconfig.json --noEmit
rg -n 'ProfileTab|name="ProfileTab"' apps/mobile/src && exit 1 || true
rg -n 'navigate\("ImportModal"\)' apps/mobile/src/features apps/mobile/src/components
```

Expected: tests/type check pass, no Profile tab remains, and the only persistent header import navigation is owned by `CoreHeaderActions` (contextual empty-state import actions may remain in feature screens).

- [ ] **Step 7: Commit the iOS shell**

```bash
git add apps/mobile/src/components apps/mobile/src/navigation apps/mobile/src/features/library/LibraryListScreen.tsx apps/mobile/src/features/profile
git commit -m "feat(ios): move account out of three-tab app shell"
```

## Task 6: Add component-state galleries, responsive visual tests, and CI gates

**Files:**
- Create: `apps/web/app/admin/design-system/page.tsx`
- Create: `apps/web/app/admin/design-system/DesignSystemGallery.tsx`
- Modify: `apps/web/app/components/AccountMenu.tsx`
- Modify: `apps/web/app/components/AccountMenu.test.tsx`
- Create: `apps/mobile/src/features/profile/DesignSystemScreen.tsx`
- Modify: `apps/mobile/src/navigation/types.ts`
- Modify: `apps/mobile/src/navigation/stacks/AccountStack.tsx`
- Modify: `apps/mobile/src/features/profile/ProfileScreen.tsx`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/shell.spec.ts`
- Create: `.github/workflows/frontend-ui.yml`
- Create: `docs/qa/2026-08-15-ui-cycle-1-checklist.md`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: all Cycle 1 components.
- Produces: reviewer-visible state examples, three responsive web baselines, automated axe checks, and one CI entry point.

- [ ] **Step 1: Create deterministic state galleries**

The web gallery is guarded with `RequireAuth` plus `isAdminUser`; non-admins receive a plain not-authorized notice. It renders headings and labeled rows for Button variants, loading/disabled states, IconButton states, LanguageControl, avatar/account trigger, focus examples, and the token color/spacing/radius swatches. It makes no API calls beyond existing authentication.

Use this guard and gallery boundary:

```tsx
// apps/web/app/admin/design-system/page.tsx
"use client";
import { RequireAuth } from "../../components/RequireAuth";
import { isAdminUser } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { DesignSystemGallery } from "./DesignSystemGallery";

function GuardedGallery() {
  const { user } = useAuth();
  if (!isAdminUser(user)) return <main><h1>Not authorized</h1></main>;
  return <DesignSystemGallery />;
}

export default function DesignSystemPage() {
  return <RequireAuth><GuardedGallery /></RequireAuth>;
}
```

`DesignSystemGallery` uses the actual primitives in this fixed order: primary/secondary/ghost/destructive buttons; disabled/loading buttons; default/pressed/disabled icon buttons; `LanguageControl`; canvas/surface/subtle/ink/muted/action/sage/error/success swatches; 4/8/12/16/24/32/40/56/72 spacing bars; and 8/12/16/24 radius samples.

Add an admin-only `Design system` link to `AccountMenu` with `href="/admin/design-system"`, and extend its existing test to assert both `Design system` and `Store cache` are present for an admin and absent for a non-admin.

The iOS `DesignSystemScreen` renders the equivalent states in a `Screen scroll` surface. Register it in `AccountStack` and expose the row only when `__DEV__` is true. It must use actual components, not screenshots or duplicated mock markup.

```tsx
// apps/mobile/src/features/profile/DesignSystemScreen.tsx
import React from "react";
import { Text } from "react-native";
import { Button, IconButton, Screen } from "../../components";
import { spacing, typography } from "../../theme";

export function DesignSystemScreen() {
  return (
    <Screen scroll contentContainerStyle={{ gap: spacing.lg }}>
      <Text style={typography.title2}>Buttons</Text>
      <Button title="Primary" onPress={() => undefined} />
      <Button title="Secondary" variant="secondary" onPress={() => undefined} />
      <Button title="Ghost" variant="ghost" onPress={() => undefined} />
      <Button title="Destructive" variant="destructive" onPress={() => undefined} />
      <Button title="Loading" loading onPress={() => undefined} />
      <Button title="Disabled" disabled onPress={() => undefined} />
      <Text style={typography.title2}>Icon controls</Text>
      <IconButton icon="add" accessibilityLabel="Add recipe" onPress={() => undefined} />
      <IconButton icon="settings-outline" accessibilityLabel="Settings" disabled onPress={() => undefined} />
    </Screen>
  );
}
```

- [ ] **Step 2: Install Playwright and axe and create the browser contract**

Run:

```bash
npm install --workspace @cooking/web --save-dev @playwright/test @axe-core/playwright
npm exec --workspace @cooking/web playwright install chromium
```

Use this Playwright server contract:

```ts
// apps/web/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: true },
  use: { baseURL: "http://127.0.0.1:3000", colorScheme: "light" },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"] } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 } } },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
```

Implement the shell contract exactly:

```ts
// apps/web/e2e/shell.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        email: "jerryxiang24@gmail.com",
        is_library_public: false,
      }),
    });
  });
  await page.goto("/settings");
});

test("renders an accessible responsive authenticated shell", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Planner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Shopping" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add Recipe" })).toBeVisible();
  const results = await new AxeBuilder({ page }).include("header").analyze();
  expect(results.violations).toEqual([]);
  await expect(page.locator("header")).toHaveScreenshot("authenticated-shell.png", {
    animations: "disabled",
  });
});

test("closes the account menu with Escape and restores focus", async ({ page }) => {
  const account = page.getByRole("button", { name: /Account/ });
  await account.click();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
});
```

Add web scripts `"test:e2e": "playwright test"` and `"test:e2e:update": "playwright test --update-snapshots"`. Add these root scripts:

```json
{
  "test:web": "npm --workspace @cooking/web test",
  "test:mobile": "npm --workspace @cooking/mobile test",
  "test:ui": "npm run tokens:test && npm run tokens:build && npm run test:web && npm run test:mobile && npx tsc -p apps/web/tsconfig.json --noEmit && npx tsc -p apps/mobile/tsconfig.json --noEmit && npm run web:build && npm --workspace @cooking/web run test:e2e"
}
```

Generate the three committed baselines once, inspect each image, then prove the normal comparison passes:

```bash
npm --workspace @cooking/web run test:e2e:update
npm --workspace @cooking/web run test:e2e
```

- [ ] **Step 3: Create the iOS simulator verification record**

The checklist contains unchecked rows for iPhone SE and iPhone 16 Pro simulators in English and Chinese. Each run verifies: exactly three tabs; plus and avatar at 44 points; Add Recipe opens and cancels back to origin; account opens without a fourth tab; language updates tab/header copy; Dynamic Type at Accessibility Large; VoiceOver labels/order; reduce motion; light appearance; library/planner/shopping content still loads. Include fields for simulator OS, commit SHA, reviewer, date, and screenshot paths.

- [ ] **Step 4: Add CI with explicit workspace commands**

Use this workflow; it does not require Apple credentials or start backend/AWS services:

```yaml
name: Frontend UI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  ui:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run tokens:test
      - run: npm run tokens:build
      - run: git diff --exit-code
      - run: npm run test:web
      - run: npm run test:mobile
      - run: npx tsc -p apps/web/tsconfig.json --noEmit
      - run: npx tsc -p apps/mobile/tsconfig.json --noEmit
      - run: npm run web:build
      - run: npm exec --workspace @cooking/web playwright install --with-deps chromium
      - run: npm --workspace @cooking/web run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: frontend-ui-failure
          path: |
            apps/web/test-results
            apps/web/playwright-report
```

- [ ] **Step 5: Run the complete Cycle 1 gate**

Run:

```bash
npm run test:ui
git diff --check
git status --short
```

Expected: all automated checks exit 0; only intended Cycle 1 files are modified; `backend/.venv_fresh/` remains untracked and unstaged.

- [ ] **Step 6: Perform the simulator checklist and commit verification assets**

Run the app with `npm run mobile:ios`, complete all checklist rows that do not require Apple Developer credentials, and record screenshot paths under `docs/qa/artifacts/ui-cycle-1/` without storing account secrets or auth tokens.

```bash
git add .github/workflows/frontend-ui.yml apps/web apps/mobile/src docs/qa package.json package-lock.json
git commit -m "test(ui): gate editorial shell across web and ios"
```

## Final Acceptance Gate

Before opening a pull request, verify all of the following from the Cycle 1 branch:

```bash
npm run tokens:test
npm run tokens:build
git diff --exit-code packages/design-tokens/dist/tokens.css
npm --workspace @cooking/web test
npm --workspace @cooking/mobile test
npx tsc -p apps/web/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.json --noEmit
npm run web:build
npm --workspace @cooking/web run test:e2e
git diff --check origin/main...HEAD
git status --short
```

Acceptance requires:

1. Web and iOS both use the shared semantic token source through platform adapters.
2. New shell components have deterministic interaction tests and no gradient/glass styling.
3. Web exposes Library, Planner, Shopping, Add Recipe, and account in the approved hierarchy.
4. iOS exposes exactly three tabs plus account avatar and global top-right plus.
5. Language and admin tools no longer occupy primary navigation.
6. Existing feature routes and data flows still compile and render.
7. Responsive web screenshots and axe checks pass at phone, tablet, and desktop sizes.
8. The iOS bilingual/VoiceOver/Dynamic Type simulator checklist is recorded.
9. No backend, scraper, deployment, subscription, or StoreKit behavior changes are present.

## Official Testing References

- Next.js 14 Vitest guide: <https://nextjs.org/docs/14/app/building-your-application/testing/vitest>
- Expo SDK unit testing with Jest Expo: <https://docs.expo.dev/develop/unit-testing/>
- Playwright visual comparisons: <https://playwright.dev/docs/test-snapshots>
