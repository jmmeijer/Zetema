import { readFile } from "node:fs/promises";

import YAML from "yaml";

const localeFiles = [
  new URL("../src/i18n/en.yaml", import.meta.url),
  new URL("../src/i18n/nl.yaml", import.meta.url),
  new URL("../src/i18n/ro.yaml", import.meta.url),
  new URL("../../../content/releases/mvp-0.1/nature-of-god.en.yaml", import.meta.url),
  new URL("../../../content/releases/mvp-0.1/locales/nl.yaml", import.meta.url),
  new URL("../../../content/releases/mvp-0.1/locales/ro.yaml", import.meta.url),
];

for (const file of localeFiles) {
  const source = await readFile(file, "utf8");
  try {
    YAML.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in ${file.pathname}: ${message}`);
  }
}

console.log(`Validated ${localeFiles.length} YAML locale/content files.`);
