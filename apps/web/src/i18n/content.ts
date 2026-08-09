import type { LocalizedText } from "@zetema/content-schema";
import YAML from "yaml";

import nlSource from "../../../../content/releases/mvp-0.1/locales/nl.yaml?raw";
import roSource from "../../../../content/releases/mvp-0.1/locales/ro.yaml?raw";
import { currentLocale, type SupportedLocale } from "./index";

type TranslationMap = Readonly<Record<string, string>>;

function parseTranslationMap(source: string, locale: SupportedLocale): TranslationMap {
  const parsed = YAML.parse(source) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Content translations for '${locale}' must be a key/value mapping.`);
  }

  const translations: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Content translation '${key}' for '${locale}' must be a non-empty string.`);
    }
    translations[key] = value;
  }

  return translations;
}

const translations: Partial<Record<SupportedLocale, TranslationMap>> = {
  nl: parseTranslationMap(nlSource, "nl"),
  ro: parseTranslationMap(roSource, "ro"),
};

export function localizeContentText(text: LocalizedText): string {
  const locale = currentLocale.value as SupportedLocale;
  if (locale === "en") {
    return text.source;
  }

  return translations[locale]?.[text.key] ?? text.source;
}
