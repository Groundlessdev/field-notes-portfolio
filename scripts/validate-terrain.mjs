import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const terrainUrl = new URL("../src/assets/terrain/", import.meta.url);
const metadata = JSON.parse(
  await readFile(new URL("monongahela-terrain.json", terrainUrl), "utf8"),
);

const fail = (message) => {
  throw new Error(`Terrain validation failed: ${message}`);
};

if (metadata.width !== 1024 || metadata.height !== 1024) {
  fail(`expected 1024x1024 metadata, received ${metadata.width}x${metadata.height}`);
}
if (metadata.byteOrder !== "little-endian") {
  fail(`unsupported byte order ${metadata.byteOrder}`);
}
if (!(metadata.minElevationM < metadata.maxElevationM)) {
  fail("elevation range is invalid");
}
if (!metadata.source?.request?.startsWith("https://elevation.nationalmap.gov/")) {
  fail("USGS source request is missing");
}

const heightPath = new URL(metadata.assets.height, terrainUrl);
const heightBuffer = await readFile(heightPath);
const expectedHeightBytes = metadata.width * metadata.height * 2;
if (heightBuffer.byteLength !== expectedHeightBytes) {
  fail(`height map is ${heightBuffer.byteLength} bytes; expected ${expectedHeightBytes}`);
}

let encodedMin = 65535;
let encodedMax = 0;
for (let offset = 0; offset < heightBuffer.byteLength; offset += 2) {
  const value = heightBuffer.readUInt16LE(offset);
  encodedMin = Math.min(encodedMin, value);
  encodedMax = Math.max(encodedMax, value);
}
if (encodedMin !== 0 || encodedMax !== 65535) {
  fail(`encoded range is ${encodedMin}–${encodedMax}; expected 0–65535`);
}

const effectsPath = new URL(metadata.assets.effects, terrainUrl);
const effectsBuffer = await readFile(effectsPath);
const pngSignature = "89504e470d0a1a0a";
if (effectsBuffer.subarray(0, 8).toString("hex") !== pngSignature) {
  fail("effects texture is not a PNG");
}
const effectsWidth = effectsBuffer.readUInt32BE(16);
const effectsHeight = effectsBuffer.readUInt32BE(20);
const bitDepth = effectsBuffer[24];
const colorType = effectsBuffer[25];
if (effectsWidth !== metadata.width || effectsHeight !== metadata.height) {
  fail(`effects texture is ${effectsWidth}x${effectsHeight}`);
}
if (bitDepth !== 8 || colorType !== 2) {
  fail(`effects texture must be 8-bit RGB; received depth ${bitDepth}, type ${colorType}`);
}

const [{ size: heightBytes }, { size: effectsBytes }] = await Promise.all([
  stat(heightPath),
  stat(effectsPath),
]);
console.log(
  `Terrain OK: ${metadata.name} · ${metadata.minElevationM.toFixed(1)}–${metadata.maxElevationM.toFixed(1)} m · ${(
    (heightBytes + effectsBytes) /
    1024 /
    1024
  ).toFixed(2)} MiB · ${root}`,
);
