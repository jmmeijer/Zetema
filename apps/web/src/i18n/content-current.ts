import type { LocalizedText } from "@zetema/content-schema";
import YAML from "yaml";

import nlRefinedSource from "../../../../content/releases/mvp-0.2/locales/v2.nl.yaml?raw";
import roRefinedSource from "../../../../content/releases/mvp-0.2/locales/v2.ro.yaml?raw";
import { currentLocale, type SupportedLocale } from "./index";
import { localizeContentText as localizeLegacyContentText } from "./content";

type TranslationMap = Readonly<Record<string, string>>;

function parseTranslationMap(source: string): TranslationMap {
  return YAML.parse(source) as TranslationMap;
}

const currentOverlays: Partial<Record<SupportedLocale, TranslationMap>> = {
  nl: parseTranslationMap(nlRefinedSource),
  ro: parseTranslationMap(roRefinedSource),
};

export function localizeContentText(text: LocalizedText, releaseId: string): string {
  if (releaseId !== "mvp-0.2.beliefs-and-background.v3") {
    return localizeLegacyContentText(text, releaseId);
  }

  const locale = currentLocale.value as SupportedLocale;
  if (locale === "en") {
    return text.source;
  }

  return currentOverlays[locale]?.[text.key] ?? localizeLegacyContentText(text, releaseId);
}
