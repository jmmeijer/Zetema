import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const brandDir = resolve(appDir, "src", "assets", "brand");
const outputDir = resolve(appDir, "public", "icons");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const BACKGROUND = [250, 246, 241, 255];

const icons = [
  { name: "icon-192.png", size: 192, markFraction: 0.76 },
  { name: "icon-512.png", size: 512, markFraction: 0.76 },
  { name: "icon-512-maskable.png", size: 512, markFraction: 0.6 },
  { name: "apple-touch-icon.png", size: 180, markFraction: 0.76 },
];

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function parsePngChunks(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Organic logo source is not a PNG file.");
  }

  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`Truncated PNG chunk '${type}'.`);
    }
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

function decodeOrganicLogo(bytes) {
  const chunks = parsePngChunks(bytes);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  const palette = chunks.find((chunk) => chunk.type === "PLTE")?.data;
  const transparency = chunks.find((chunk) => chunk.type === "tRNS")?.data;
  const idat = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data);

  if (!ihdr || !palette || idat.length === 0) {
    throw new Error("Organic logo PNG is missing required image data.");
  }

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filterMethod = ihdr[11];
  const interlace = ihdr[12];

  if (
    bitDepth !== 8 ||
    colorType !== 3 ||
    compression !== 0 ||
    filterMethod !== 0 ||
    interlace !== 0
  ) {
    throw new Error(
      `Unsupported organic logo PNG format (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}).`,
    );
  }

  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width;
  if (inflated.length !== (stride + 1) * height) {
    throw new Error("Unexpected decoded size for organic logo PNG.");
  }

  const indices = Buffer.alloc(width * height);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const encoded = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const row = Buffer.alloc(stride);

    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[x];
      const left = x > 0 ? row[x - 1] : 0;
      const up = previous[x];
      const upLeft = x > 0 ? previous[x - 1] : 0;
      let value;

      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4:
          value = raw + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filter}.`);
      }

      row[x] = value & 0xff;
    }

    row.copy(indices, y * width);
    previous = row;
  }

  const rgba = new Uint8Array(width * height * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0; i < indices.length; i += 1) {
    const paletteIndex = indices[i];
    const paletteOffset = paletteIndex * 3;
    if (paletteOffset + 2 >= palette.length) {
      throw new Error(`Palette index ${paletteIndex} is outside the PNG palette.`);
    }

    const out = i * 4;
    const alpha = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
    rgba[out] = palette[paletteOffset];
    rgba[out + 1] = palette[paletteOffset + 1];
    rgba[out + 2] = palette[paletteOffset + 2];
    rgba[out + 3] = alpha;

    if (alpha > 0) {
      const x = i % width;
      const y = Math.floor(i / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error("Organic logo PNG contains no visible pixels.");
  }

  return {
    width,
    height,
    rgba,
    bounds: { minX, minY, maxX, maxY },
  };
}

function samplePremultiplied(image, x, y) {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const weights = [
    [(1 - tx) * (1 - ty), x0, y0],
    [tx * (1 - ty), x1, y0],
    [(1 - tx) * ty, x0, y1],
    [tx * ty, x1, y1],
  ];

  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (const [weight, sx, sy] of weights) {
    const offset = (sy * image.width + sx) * 4;
    const a = image.rgba[offset + 3] / 255;
    alpha += weight * a;
    red += weight * image.rgba[offset] * a;
    green += weight * image.rgba[offset + 1] * a;
    blue += weight * image.rgba[offset + 2] * a;
  }

  if (alpha <= 0) return [0, 0, 0, 0];
  return [red / alpha, green / alpha, blue / alpha, alpha];
}

function renderIcon(source, size, markFraction) {
  const output = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const offset = i * 4;
    output[offset] = BACKGROUND[0];
    output[offset + 1] = BACKGROUND[1];
    output[offset + 2] = BACKGROUND[2];
    output[offset + 3] = BACKGROUND[3];
  }

  const sourceWidth = source.bounds.maxX - source.bounds.minX + 1;
  const sourceHeight = source.bounds.maxY - source.bounds.minY + 1;
  const targetBox = size * markFraction;
  const scale = Math.min(targetBox / sourceWidth, targetBox / sourceHeight);
  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;
  const targetX = (size - targetWidth) / 2;
  const targetY = (size - targetHeight) / 2;

  const xStart = Math.max(0, Math.floor(targetX));
  const xEnd = Math.min(size, Math.ceil(targetX + targetWidth));
  const yStart = Math.max(0, Math.floor(targetY));
  const yEnd = Math.min(size, Math.ceil(targetY + targetHeight));

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const sourceX = source.bounds.minX + (x + 0.5 - targetX) / scale - 0.5;
      const sourceY = source.bounds.minY + (y + 0.5 - targetY) / scale - 0.5;
      const [red, green, blue, alpha] = samplePremultiplied(source, sourceX, sourceY);
      if (alpha <= 0) continue;

      const offset = (y * size + x) * 4;
      output[offset] = Math.round(red * alpha + BACKGROUND[0] * (1 - alpha));
      output[offset + 1] = Math.round(green * alpha + BACKGROUND[1] * (1 - alpha));
      output[offset + 2] = Math.round(blue * alpha + BACKGROUND[2] * (1 - alpha));
      output[offset + 3] = 255;
    }
  }

  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodeRgbaPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function loadOrganicLogo() {
  const parts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      readFile(resolve(brandDir, `zetema-logo-organic.part${index + 1}.b64`), "utf8"),
    ),
  );
  return Buffer.from(parts.map((part) => part.trim()).join(""), "base64");
}

await mkdir(outputDir, { recursive: true });

const organicLogo = decodeOrganicLogo(await loadOrganicLogo());
for (const icon of icons) {
  const rgba = renderIcon(organicLogo, icon.size, icon.markFraction);
  const png = encodeRgbaPng(icon.size, icon.size, rgba);
  await writeFile(resolve(outputDir, icon.name), png);
}
