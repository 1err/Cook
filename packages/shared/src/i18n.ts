import en from "./messages/en.json";
import zh from "./messages/zh.json";

export type Language = "en" | "zh";
export type Messages = Record<string, string>;

export const MESSAGE_MAP: Record<Language, Messages> = { en, zh };
