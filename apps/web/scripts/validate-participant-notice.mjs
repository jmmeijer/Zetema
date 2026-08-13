import { readFile } from "node:fs/promises";
import YAML from "yaml";

const base = new URL("../src/privacy/notices/2026.08.1/", import.meta.url);
const files = {
  en: [new URL("en.yaml", base)],
  nl: [
    new URL("nl-age.yaml", base),
    new URL("nl-data.yaml", base),
    new URL("nl-choice.yaml", base),
    new URL("nl-acceptance.yaml", base),
    new URL("nl-outcome.yaml", base),
  ],
  ro: [
    new URL("ro-age.yaml", base),
    new URL("ro-data.yaml", base),
    new URL("ro-extra.yaml", base),
    new URL("ro-actions.yaml", base),
    new URL("ro-status.yaml", base),
  ],
};

async function parseMap(file) {
  const parsed = YAML.parse(await readFile(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file.pathname} must contain a key/value mapping.`);
  }
  return parsed;
}

async function mergeLocale(locale, localeFiles) {
  const merged = {};
  for (const file of localeFiles) {
    const parsed = await parseMap(file);
    for (const [key, value] of Object.entries(parsed)) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`Duplicate preflight key '${key}' in '${locale}'.`);
      }
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Preflight key '${key}' in '${locale}' must be a non-empty string.`);
      }
      merged[key] = value;
    }
  }
  return merged;
}

const translations = {};
for (const [locale, localeFiles] of Object.entries(files)) {
  translations[locale] = await mergeLocale(locale, localeFiles);
}

const canonicalKeys = Object.keys(translations.en).sort();
for (const locale of ["nl", "ro"]) {
  const keys = Object.keys(translations[locale]).sort();
  const missing = canonicalKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !canonicalKeys.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Participant notice '${locale}' does not match EN keys. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
    );
  }
}

console.log(
  `Validated participant notice 2026.08.1 in ${Object.keys(translations).length} locales (${canonicalKeys.length} keys).`,
);
