import type { MenuStyleId } from "./types";

export const MENU_STYLE_IDS = [
  "cozy-cafe",
  "french-bistro",
  "garden-table",
  "italian-supper",
  "chinese-teahouse",
  "minimal-modern",
] as const satisfies readonly MenuStyleId[];

export type MenuFontFamily = "MenuSerif" | "MenuSans";

export type MenuStylePreset = {
  id: MenuStyleId;
  labelKey: `menu.style.${MenuStyleId}`;
  colors: {
    background: string;
    panel: string;
    text: string;
    accent: string;
  };
  titleFamily: MenuFontFamily;
  bodyFamily: MenuFontFamily;
  titleAlign: "left" | "center";
  ornamentSvg: string;
};

export const MENU_STYLES: readonly MenuStylePreset[] = [
  {
    id: "cozy-cafe",
    labelKey: "menu.style.cozy-cafe",
    colors: { background: "#F7E8A4", panel: "#FFF9EC", text: "#3D2A24", accent: "#D88982" },
    titleFamily: "MenuSerif",
    bodyFamily: "MenuSerif",
    titleAlign: "center",
    ornamentSvg:
      '<svg viewBox="0 0 816 1056" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#D88982" stroke-width="4" stroke-linecap="round"><path d="M38 90c34-30 68-30 102 0M676 90c34-30 68-30 102 0"/><circle cx="68" cy="978" r="18"/><circle cx="748" cy="978" r="18"/></g></svg>',
  },
  {
    id: "french-bistro",
    labelKey: "menu.style.french-bistro",
    colors: { background: "#F7F0E4", panel: "#FFF9F0", text: "#4A1720", accent: "#7B2636" },
    titleFamily: "MenuSerif",
    bodyFamily: "MenuSerif",
    titleAlign: "center",
    ornamentSvg:
      '<svg viewBox="0 0 816 1056" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#7B2636" stroke-width="3"><rect x="28" y="28" width="760" height="1000" rx="8"/><rect x="42" y="42" width="732" height="972" rx="6"/><path d="M348 66h120M348 990h120"/></g></svg>',
  },
  {
    id: "garden-table",
    labelKey: "menu.style.garden-table",
    colors: { background: "#DFE7D3", panel: "#FBF8EC", text: "#2F3D2D", accent: "#7B8F68" },
    titleFamily: "MenuSerif",
    bodyFamily: "MenuSerif",
    titleAlign: "center",
    ornamentSvg:
      '<svg viewBox="0 0 816 1056" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#7B8F68" stroke-width="4" stroke-linecap="round"><path d="M46 174c72-20 92-72 80-126M70 118c-30-4-42-20-48-44M770 882c-72 20-92 72-80 126M746 938c30 4 42 20 48 44"/></g></svg>',
  },
  {
    id: "italian-supper",
    labelKey: "menu.style.italian-supper",
    colors: { background: "#F7E6D4", panel: "#FFF8EA", text: "#3D2A1F", accent: "#B84332" },
    titleFamily: "MenuSerif",
    bodyFamily: "MenuSerif",
    titleAlign: "left",
    ornamentSvg:
      '<svg viewBox="0 0 816 1056" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#B84332" stroke-width="5"><circle cx="80" cy="82" r="28"/><path d="M53 82h54M80 55v54M708 974c42-44 72-40 80-4M730 990c12-44 34-58 66-46"/></g></svg>',
  },
  {
    id: "chinese-teahouse",
    labelKey: "menu.style.chinese-teahouse",
    colors: { background: "#EFE3CC", panel: "#FBF5E8", text: "#332820", accent: "#9D463D" },
    titleFamily: "MenuSerif",
    bodyFamily: "MenuSans",
    titleAlign: "center",
    ornamentSvg:
      '<svg viewBox="0 0 816 1056" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#9D463D" stroke-width="3"><path d="M34 132V34h98M782 924v98h-98"/><path d="M58 104c44-10 62-30 72-66M758 952c-44 10-62 30-72 66"/></g></svg>',
  },
  {
    id: "minimal-modern",
    labelKey: "menu.style.minimal-modern",
    colors: { background: "#F8F5EF", panel: "#FFFCF7", text: "#262626", accent: "#756D63" },
    titleFamily: "MenuSans",
    bodyFamily: "MenuSans",
    titleAlign: "left",
    ornamentSvg:
      '<svg viewBox="0 0 816 1056" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#756D63" stroke-width="2"><path d="M48 48h120M48 48v120M768 1008H648M768 1008V888"/></g></svg>',
  },
];

export const MENU_STYLES_BY_ID: Readonly<Record<MenuStyleId, MenuStylePreset>> = Object.fromEntries(
  MENU_STYLES.map((style) => [style.id, style]),
) as Record<MenuStyleId, MenuStylePreset>;
