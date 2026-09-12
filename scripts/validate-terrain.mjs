import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const terrainUrl = new URL("../src/assets/terrain/", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("monongahela-terrain.json", terrainUrl), "utf8"));

const fail = (message) => {
  throw new Error(`Terrain validation failed: ${message}`);
};

if (metadata.schemaVersion !== 2) fail(`expected schema version 2, received ${metadata.schemaVersion}`);
if (!Number.isInteger(metadata.tileInteriorSize) || metadata.tileInteriorSize < 2) fail("tile interior size is invalid");
if (metadata.textureWidth !== metadata.tileInteriorSize + metadata.textureGutter * 2) fail("texture width and gutter disagree");
if (metadata.textureHeight !== metadata.tileInteriorSize + metadata.textureGutter * 2) fail("texture height and gutter disagree");
if (metadata.byteOrder !== "little-endian") fail(`unsupported byte order ${metadata.byteOrder}`);
if (!(metadata.minElevationM < metadata.maxElevationM)) fail("shared elevation range is invalid");
if (!(metadata.metersPerWorldUnit > 0) || !(metadata.tileWorldSize > 0)) fail("world scale is invalid");
if (!metadata.source?.request?.startsWith("https://elevation.nationalmap.gov/")) fail("USGS source request is missing");
if (!Array.isArray(metadata.tiles) || metadata.tiles.length < 2) fail("terrain grid needs multiple tiles");
if (metadata.flightPath?.positions?.length !== metadata.flightPath?.lookAt?.length || metadata.flightPath.positions.length < 4) {
  fail("flight path position and look-at controls are incomplete");
}

const tileByGrid = new Map();
const loadedTiles = new Map();
let totalBytes = 0;

for (const tile of metadata.tiles) {
  const key = `${tile.grid.column},${tile.grid.row}`;
  if (tileByGrid.has(key)) fail(`duplicate grid coordinate ${key}`);
  tileByGrid.set(key, tile);
  if (!(tile.observedElevationM.min <= tile.observedElevationM.max)) fail(`${tile.id} elevation range is invalid`);

  const heightPath = new URL(tile.assets.height, terrainUrl);
  const heightBuffer = await readFile(heightPath);
  const expectedHeightBytes = metadata.textureWidth * metadata.textureHeight * 2;
  if (heightBuffer.byteLength !== expectedHeightBytes) {
    fail(`${tile.id} height map is ${heightBuffer.byteLength} bytes; expected ${expectedHeightBytes}`);
  }

  const effectsPath = new URL(tile.assets.effects, terrainUrl);
  const effectsBuffer = await readFile(effectsPath);
  if (effectsBuffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") fail(`${tile.id} effects texture is not a PNG`);
  const effectsWidth = effectsBuffer.readUInt32BE(16);
  const effectsHeight = effectsBuffer.readUInt32BE(20);
  if (effectsWidth !== metadata.textureWidth || effectsHeight !== metadata.textureHeight) {
    fail(`${tile.id} effects texture is ${effectsWidth}x${effectsHeight}`);
  }
  if (effectsBuffer[24] !== 8 || effectsBuffer[25] !== 2) fail(`${tile.id} effects texture must be 8-bit RGB`);

  const [{ size: heightBytes }, { size: effectsBytes }] = await Promise.all([stat(heightPath), stat(effectsPath)]);
  totalBytes += heightBytes + effectsBytes;
  loadedTiles.set(tile.id, heightBuffer);
}

const valueAt = (buffer, x, y) => buffer.readUInt16LE((y * metadata.textureWidth + x) * 2);
const gutter = metadata.textureGutter;
const interior = metadata.tileInteriorSize;

for (const tile of metadata.tiles) {
  const buffer = loadedTiles.get(tile.id);
  const east = tileByGrid.get(`${tile.grid.column + 1},${tile.grid.row}`);
  if (east) {
    const eastBuffer = loadedTiles.get(east.id);
    for (let y = gutter; y < gutter + interior; y += 1) {
      if (valueAt(buffer, gutter + interior, y) !== valueAt(eastBuffer, gutter, y)) fail(`${tile.id}/${east.id} east gutter mismatch at row ${y}`);
      if (valueAt(eastBuffer, gutter - 1, y) !== valueAt(buffer, gutter + interior - 1, y)) fail(`${tile.id}/${east.id} west gutter mismatch at row ${y}`);
    }
    if (Math.abs(tile.projectedBounds.xmax - east.projectedBounds.xmin) > 0.001) fail(`${tile.id}/${east.id} projected bounds do not meet`);
  }

  const south = tileByGrid.get(`${tile.grid.column},${tile.grid.row + 1}`);
  if (south) {
    const southBuffer = loadedTiles.get(south.id);
    for (let x = gutter; x < gutter + interior; x += 1) {
      if (valueAt(buffer, x, gutter + interior) !== valueAt(southBuffer, x, gutter)) fail(`${tile.id}/${south.id} south gutter mismatch at column ${x}`);
      if (valueAt(southBuffer, x, gutter - 1) !== valueAt(buffer, x, gutter + interior - 1)) fail(`${tile.id}/${south.id} north gutter mismatch at column ${x}`);
    }
    if (Math.abs(tile.projectedBounds.ymin - south.projectedBounds.ymax) > 0.001) fail(`${tile.id}/${south.id} projected bounds do not meet`);
  }
}

console.log(
  `Terrain OK: ${metadata.tiles.length} tiles · ${metadata.minElevationM.toFixed(1)}–${metadata.maxElevationM.toFixed(1)} m · ${(totalBytes / 1024 / 1024).toFixed(2)} MiB · ${root}`,
);
