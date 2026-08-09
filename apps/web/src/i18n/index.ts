import { createI18n } from "vue-i18n";
import YAML from "yaml";

import enSource from "./en.yaml?raw";
import nlSource from "./nl.yaml?raw";
import roSource from "./ro.yaml?raw";

export const supportedLocales = ["en", "nl", "ro"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const localeOptions: readonly {
  value: SupportedLocale;
  code: string;
  nativeName: string;
}[] = [
  { value: "en", code: "EN", nativeName: "English" },
  { value: "nl", code: "NL", nativeName: "Nederlands" },
  { value: "ro", code: "RO", nativeName: "Română" },
];

const LOCALE_STORAGE_KEY = "zetema.locale";

function isSupportedLocale(value: string): value is SupportedLocale {
  return supportedLocales.includes(value as SupportedLocale);
}

function normalizeLocale(value: string | null | undefined): SupportedLocale | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (isSupportedLocale(normalized)) {
    return normalized;
  }

  const language = normalized.split("-")[0];
  return language !== undefined && isSupportedLocale(language) ? language : undefined;
}

function readStoredLocale(): SupportedLocale | undefined {
  try {
    return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

function detectBrowserLocale(): SupportedLocale | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  for (const candidate of navigator.languages ?? [navigator.language]) {
    const locale = normalizeLocale(candidate);
    if (locale !== undefined) {
      return locale;
    }
  }

  return undefined;
}

const initialLocale = readStoredLocale() ?? detectBrowserLocale() ?? "en";

const messages = {
  en: YAML.parse(enSource),
  nl: YAML.parse(nlSource),
  ro: YAML.parse(roSource),
};

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: "en",
  messages,
});

export const currentLocale = i18n.global.locale;

// vue-i18n's strongly typed `t` overload recursively derives message-key paths.
// Our messages are loaded from YAML at runtime and callers intentionally use
// runtime string keys, so keep that complexity behind this small stable wrapper.
type RuntimeTranslate = (
  key: string,
  named?: Record<string, string | number>,
) => string;

const runtimeTranslate = i18n.global.t as unknown as RuntimeTranslate;

function updateDocumentLanguage(locale: SupportedLocale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

updateDocumentLanguage(initialLocale);

export function setLocale(locale: SupportedLocale): void {
  currentLocale.value = locale;
  updateDocumentLanguage(locale);

  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Locale persistence is best-effort; the selected language still applies for this page load.
  }
}

export function translate(
  key: string,
  named?: Record<string, string | number>,
): string {
  // Reading the locale keeps callers such as computed summaries reactive when the
  // language changes, even though they use the global i18n instance directly.
  void currentLocale.value;
  return runtimeTranslate(key, named);
}
