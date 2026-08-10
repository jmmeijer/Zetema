import { readFile } from "node:fs/promises";

import YAML from "yaml";

const uiLocaleFiles = [
  new URL("../src/i18n/en.yaml", import.meta.url),
  new URL("../src/i18n/nl.yaml", import.meta.url),
  new URL("../src/i18n/ro.yaml", import.meta.url),
];
const contentReleaseFile = new URL(
  "../../../content/releases/mvp-0.1/nature-of-god.en.yaml",
  import.meta.url,
);
const contentLocaleFiles = [
  ["nl", new URL("../../../content/releases/mvp-0.1/locales/nl.yaml", import.meta.url)],
  ["ro", new URL("../../../content/releases/mvp-0.1/locales/ro.yaml", import.meta.url)],
];

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

  for (const child of Object.values(value)) {
    collectLocalizedKeys(child, keys);
  }

  return keys;
}

for (const file of uiLocaleFiles) {
  await parseYaml(file);
}

const release = await parseYaml(contentReleaseFile);
const requiredContentKeys = [...collectLocalizedKeys(release)].sort();

for (const [locale, file] of contentLocaleFiles) {
  const translations = await parseYaml(file);
  if (typeof translations !== "object" || translations === null || Array.isArray(translations)) {
    throw new Error(`Content translations for '${locale}' must be a key/value mapping.`);
  }

  const missing = requiredContentKeys.filter(
    (key) => typeof translations[key] !== "string" || translations[key].trim().length === 0,
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing ${locale} content translations: ${missing.join(", ")}`,
    );
  }
}

console.log(
  `Validated ${uiLocaleFiles.length + contentLocaleFiles.length + 1} YAML locale/content files and ${requiredContentKeys.length} localized content keys.`,
);
