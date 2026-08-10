import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const sourceDir = resolve(appDir, "pwa-assets");
const outputDir = resolve(appDir, "public", "icons");

const icons = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-512-maskable.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

await mkdir(outputDir, { recursive: true });

for (const icon of icons) {
  const source = await readFile(resolve(sourceDir, `${icon.name}.b64`), "utf8");
  const bytes = Buffer.from(source.trim(), "base64");

  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Invalid PNG source for ${icon.name}`);
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== icon.size || height !== icon.size) {
    throw new Error(
      `Unexpected dimensions for ${icon.name}: ${width}x${height}, expected ${icon.size}x${icon.size}`,
    );
  }

  await writeFile(resolve(outputDir, icon.name), bytes);
}
