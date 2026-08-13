import type { LocalizedText } from "@zetema/content-schema";
import YAML from "yaml";

import nlV01Source from "../../../../content/releases/mvp-0.1/locales/nl.yaml?raw";
import roV01Source from "../../../../content/releases/mvp-0.1/locales/ro.yaml?raw";
import nlV02Source from "../../../../content/releases/mvp-0.2/locales/nl.yaml?raw";
import roV02Source from "../../../../content/releases/mvp-0.2/locales/ro.yaml?raw";
import nlV02V2Source from "../../../../content/releases/mvp-0.2/locales/v2.nl.yaml?raw";
import roV02V2Source from "../../../../content/releases/mvp-0.2/locales/v2.ro.yaml?raw";
import { currentLocale, type SupportedLocale } from "./index";

type TranslationMap = Readonly<Record<string, string>>;
type ReleaseTranslations = Partial<Record<SupportedLocale, TranslationMap>>;

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

function mergeTranslationMaps(
  base: TranslationMap,
  overlay: TranslationMap,
): TranslationMap {
  return { ...base, ...overlay };
}

const v01Translations: ReleaseTranslations = {
  nl: parseTranslationMap(nlV01Source, "nl"),
  ro: parseTranslationMap(roV01Source, "ro"),
};
const v02Translations: ReleaseTranslations = {
  nl: parseTranslationMap(nlV02Source, "nl"),
  ro: parseTranslationMap(roV02Source, "ro"),
};
const v02V2Translations: ReleaseTranslations = {
  nl: mergeTranslationMaps(
    parseTranslationMap(nlV02Source, "nl"),
    parseTranslationMap(nlV02V2Source, "nl"),
  ),
  ro: mergeTranslationMaps(
    parseTranslationMap(roV02Source, "ro"),
    parseTranslationMap(roV02V2Source, "ro"),
  ),
};

function translationsForRelease(releaseId: string): ReleaseTranslations {
  if (releaseId.startsWith("mvp-0.1.")) {
    return v01Translations;
  }

  const usesRefinedWording =
    releaseId === "mvp-0.2.beliefs-and-background.v2" ||
    releaseId === "mvp-0.2.beliefs-and-background.v3";

  return usesRefinedWording ? v02V2Translations : v02Translations;
}

export function localizeContentText(text: LocalizedText, releaseId: string): string {
  const locale = currentLocale.value as SupportedLocale;
  if (locale === "en") {
    return text.source;
  }

  return translationsForRelease(releaseId)[locale]?.[text.key] ?? text.source;
}
