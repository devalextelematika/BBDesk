import { useMemo } from "react";
import { useSettings } from "@get-bb/plugin-sdk/app";
import { createTranslator, resolveLanguage } from "./i18n";

export function useTranslation() {
  const { values, isLoading } = useSettings();
  const language = resolveLanguage(values?.language);
  const t = useMemo(() => createTranslator(language), [language]);
  return { t, language, isLoading };
}
