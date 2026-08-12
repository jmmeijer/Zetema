import { readFile } from "node:fs/promises";

import YAML from "yaml";

const uiLocaleFiles = [
  new URL("../src/i18n/en.yaml", import.meta.url),
  new URL("../src/i18n/nl.yaml", import.meta.url),
  new URL("../src/i18n/ro.yaml", import.meta.url),
];
const canonicalContentFiles = [
  new URL("../../../content/releases/mvp-0.1/nature-of-god.en.yaml", import.meta.url),
  new URL("../../../content/releases/mvp-0.1/beliefs-and-background.en.yaml", import.meta.url),
  new URL("../../../content/releases/mvp-0.2/beliefs-and-background.en.yaml", import.meta.url),
];
const contentLocaleFiles = {
  nl: [
    new URL("../../../content/releases/mvp-0.2/locales/nl.yaml", import.meta.url),
    new URL("../../../content/releases/mvp-0.2/locales/v2.nl.yaml", import.meta.url),
  ],
  ro: [
    new URL("../../../content/releases/mvp-0.2/locales/ro.yaml", import.meta.url),
    new URL("../../../content/releases/mvp-0.2/locales/v2.ro.yaml", import.meta.url),
  ],
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
    for (const item of value) {
      collectLocalizedKeys(item, keys);
    }
    return keys;
  }

  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (typeof value.key === "string" && typeof value.source === "string") {
    keys.add(value.key);
  }

  for (const nested of Object.values(value)) {
    collectLocalizedKeys(nested, keys);
  }

  return keys;
}

for (const file of uiLocaleFiles) {
  await parseYaml(file);
}

const requiredContentKeys = new Set();
for (const file of canonicalContentFiles) {
  collectLocalizedKeys(await parseYaml(file), requiredContentKeys);
}

for (const [locale, files] of Object.entries(contentLocaleFiles)) {
  const translations = {};

  for (const file of files) {
    const parsed = await parseYaml(file);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Content translations for '${locale}' must be key/value mappings.`);
    }
    Object.assign(translations, parsed);
  }

  const missing = [...requiredContentKeys].filter(
    (key) => typeof translations[key] !== "string" || translations[key].trim().length === 0,
  );

  if (missing.length > 0) {
    throw new Error(
      `Content translations for '${locale}' are missing ${missing.length} keys: ${missing.join(", ")}`,
    );
  }
}

console.log(
  `Validated ${uiLocaleFiles.length} UI locale files, ${canonicalContentFiles.length} content releases, and complete NL/RO content translations.`,
);
