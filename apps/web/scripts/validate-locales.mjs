import { readFile } from "node:fs/promises";

import YAML from "yaml";

const files = {
  uiEn: new URL("../src/i18n/en.yaml", import.meta.url),
  uiNl: new URL("../src/i18n/nl.yaml", import.meta.url),
  uiRo: new URL("../src/i18n/ro.yaml", import.meta.url),
  natureOfGod: new URL("../../../content/releases/mvp-0.1/nature-of-god.en.yaml", import.meta.url),
  beliefsAndBackground: new URL(
    "../../../content/releases/mvp-0.1/beliefs-and-background.en.yaml",
    import.meta.url,
  ),
  contentNl: new URL("../../../content/releases/mvp-0.1/locales/nl.yaml", import.meta.url),
  contentRo: new URL("../../../content/releases/mvp-0.1/locales/ro.yaml", import.meta.url),
};

async function parseYaml(file) {
  const source = await readFile(file, "utf8");
  try {
    return YAML.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in ${file.pathname}: ${message}`);
  }
}

function collectLocalizedKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLocalizedKeys(entry, keys);
    }
    return keys;
  }

  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (typeof value.key === "string" && typeof value.source === "string") {
    keys.add(value.key);
  }

  for (const entry of Object.values(value)) {
    collectLocalizedKeys(entry, keys);
  }

  return keys;
}

function assertTranslationCoverage(locale, translations, requiredKeys) {
  if (typeof translations !== "object" || translations === null || Array.isArray(translations)) {
    throw new Error(`Content translations for '${locale}' must be a key/value mapping.`);
  }

  const missing = [...requiredKeys].filter(
    (key) => typeof translations[key] !== "string" || translations[key].trim().length === 0,
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing ${locale} content translations: ${missing.sort().join(", ")}`,
    );
  }
}

const parsed = {};
for (const [name, file] of Object.entries(files)) {
  parsed[name] = await parseYaml(file);
}

const requiredContentKeys = collectLocalizedKeys(parsed.beliefsAndBackground);
assertTranslationCoverage("nl", parsed.contentNl, requiredContentKeys);
assertTranslationCoverage("ro", parsed.contentRo, requiredContentKeys);

console.log(
  `Validated ${Object.keys(files).length} YAML locale/content files and ${requiredContentKeys.size} translated content keys.`,
);
