import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const sourceDir = resolve(appDir, "pwa-assets");
const outputDir = resolve(appDir, "public", "icons");

const icons = [
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
];

await mkdir(outputDir, { recursive: true });

for (const icon of icons) {
  const source = await readFile(resolve(sourceDir, `${icon}.b64`), "utf8");
  const bytes = Buffer.from(source.trim(), "base64");

  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Invalid PNG source for ${icon}`);
  }

  await writeFile(resolve(outputDir, icon), bytes);
}
