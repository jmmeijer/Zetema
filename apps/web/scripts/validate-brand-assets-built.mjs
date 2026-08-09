import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const distRoot = new URL("../dist/", import.meta.url);

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(path)));
    } else if (/\.(?:html|js|css)$/u.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

const files = await collectTextFiles(distRoot.pathname);
const output = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

const requiredDataUrls = ["data:image/png;base64,", "data:image/webp;base64,"];
for (const prefix of requiredDataUrls) {
  if (!output.includes(prefix)) {
    throw new Error(`Expected built brand asset ${prefix} was not inlined into the production bundle.`);
  }
}

console.log("Validated inline PNG logo and WebP watercolor in production bundle.");
