import type { Plugin, Ref } from "vue";
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

type RuntimeMessages = Record<string, unknown>;
type RuntimeTranslate = (
  key: string,
  named?: Record<string, string | number>,
) => string;

type RuntimeI18n = Plugin & {
  global: {
    locale: Ref<SupportedLocale>;
    t: RuntimeTranslate;
  };
};

type RuntimeI18nFactory = (options: {
  legacy: false;
  locale: SupportedLocale;
  fallbackLocale: SupportedLocale;
  messages: Record<SupportedLocale, RuntimeMessages>;
}) => RuntimeI18n;

// vue-i18n's public factory carries deeply recursive schema/key generics. Zetema's
// UI messages are YAML parsed at runtime and intentionally addressed by runtime
// string keys, so erase those compile-time schema generics at this boundary.
const createRuntimeI18n = createI18n as unknown as RuntimeI18nFactory;

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

const messages: Record<SupportedLocale, RuntimeMessages> = {
  en: YAML.parse(enSource) as RuntimeMessages,
  nl: YAML.parse(nlSource) as RuntimeMessages,
  ro: YAML.parse(roSource) as RuntimeMessages,
};

export const i18n = createRuntimeI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: "en",
  messages,
});

export const currentLocale = i18n.global.locale;
const runtimeTranslate = i18n.global.t;

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
