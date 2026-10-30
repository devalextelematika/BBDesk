import { en } from "./locales/en.ts";
import { ru } from "./locales/ru.ts";

export type Language = "en" | "ru";
export type MessageKey = keyof typeof en;
export type PluralMessage = { one: string; few?: string; many?: string; other: string };
export type Messages = Record<MessageKey, string | PluralMessage>;
export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

export const languageSetting = {
  type: "select" as const, label: "Interface language", options: ["en", "ru"],
  experimental_optionLabels: { en: "English", ru: "Русский" }, default: "en",
};

export function resolveLanguage(value: unknown): Language { return value === "ru" ? "ru" : "en"; }

export function createTranslator(language: Language): Translator {
  const catalog: Messages = language === "ru" ? ru : en;
  const plurals = new Intl.PluralRules(language);
  return (key, params = {}) => {
    const message = catalog[key] ?? en[key];
    const count = typeof params.count === "number" ? params.count : 0;
    const template = typeof message === "string" ? message
      : message[plurals.select(count) as keyof PluralMessage] ?? message.other;
    return template.replace(/\{(\w+)\}/g, (token, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : token);
  };
}
