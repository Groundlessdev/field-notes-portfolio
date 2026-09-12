"""Convert an aligned USGS 3DEP mosaic into seamless web terrain tiles.

The source mosaic covers a 3x3 grid around the original Spruce Knob–Seneca
Rocks tile. Derivatives are calculated across the complete mosaic before tiles
are cut, so internal borders do not acquire lighting or hydrology seams.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
from PIL import Image, ImageFilter


SERVICE_URL = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/"
    "ImageServer/exportImage"
)
TILE_SIZE = 1024
GRID_SIZE = 3
GUTTER = 1
TEXTURE_SIZE = TILE_SIZE + GUTTER * 2
TILE_WIDTH_M = 47867.381
TILE_DEPTH_M = 47126.946
TILE_WORLD_SIZE = 20.0
TERRAIN_HEIGHT = 3.8

CENTER_PROJECTED_BOUNDS = {
    "xmin": -8869937.026,
    "ymin": 4667385.084,
    "xmax": -8822069.645,
    "ymax": 4714512.030,
}

# source_column/source_row address the downloaded 3x3 mosaic. grid.row grows
# southward to match image rows and the Three.js terrain's positive Z axis.
TILES = (
    {"id": "c", "name": "Spruce Knob–Seneca Rocks", "column": 0, "row": 0, "source_column": 1, "source_row": 1},
    {"id": "s", "name": "South Fork–Franklin", "column": 0, "row": 1, "source_column": 1, "source_row": 2},
    {"id": "sw", "name": "Greenbrier Valley", "column": -1, "row": 1, "source_column": 0, "source_row": 2},
    {"id": "w", "name": "Cheat Mountain", "column": -1, "row": 0, "source_column": 0, "source_row": 1},
    {"id": "n", "name": "Northern Monongahela", "column": 0, "row": -1, "source_column": 1, "source_row": 0},
)


def normalized(values: np.ndarray, low: float | None = None, high: float | None = None) -> np.ndarray:
    low = float(np.nanmin(values) if low is None else low)
    high = float(np.nanmax(values) if high is None else high)
    return np.clip((values - low) / max(high - low, 1e-9), 0.0, 1.0)


def hydrology_mask(elevation: np.ndarray) -> tuple[np.ndarray, int]:
    """Create a deterministic D8 flow-accumulation mask on a smaller grid."""

    sample_size = max(256, max(elevation.shape) // 4)
    sampled = np.asarray(
        Image.fromarray(elevation.astype(np.float32), mode="F").resize(
            (sample_size, sample_size), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    )
    height, width = sampled.shape
    destination = np.full(height * width, -1, dtype=np.int32)
    neighbors = (
        (-1, -1, 1.4142), (0, -1, 1.0), (1, -1, 1.4142),
        (-1, 0, 1.0), (1, 0, 1.0),
        (-1, 1, 1.4142), (0, 1, 1.0), (1, 1, 1.4142),
    )

    for y in range(1, height - 1):
        for x in range(1, width - 1):
            current = sampled[y, x]
            best_drop = 0.0
            best_index = -1
            for dx, dy, distance in neighbors:
                drop = (current - sampled[y + dy, x + dx]) / distance
                if drop > best_drop:
                    best_drop = drop
                    best_index = (y + dy) * width + (x + dx)
            destination[y * width + x] = best_index

    accumulation = np.ones(height * width, dtype=np.uint32)
    for index in np.argsort(sampled, axis=None)[::-1]:
        target = destination[index]
        if target >= 0:
            accumulation[target] += accumulation[index]

    accumulation = accumulation.reshape((height, width))
    log_flow = np.log1p(accumulation.astype(np.float32))
    threshold = float(np.percentile(log_flow, 91.5))
    flow = normalized(log_flow, threshold, float(np.percentile(log_flow, 99.92)))
    flow = np.power(flow, 0.7)
    flow_image = Image.fromarray(np.uint8(flow * 255), mode="L")
    flow_image = flow_image.resize(elevation.shape[::-1], Image.Resampling.BICUBIC)
    flow_image = flow_image.filter(ImageFilter.GaussianBlur(0.75))
    return np.asarray(flow_image, dtype=np.float32) / 255.0, int(accumulation.max())


def derivative_texture(elevation: np.ndarray) -> tuple[np.ndarray, dict[str, float | int]]:
    terrain = normalized(elevation)
    terrain_image = Image.fromarray(np.uint8(terrain * 255), mode="L")
    broad = np.asarray(terrain_image.filter(ImageFilter.GaussianBlur(12.0)), dtype=np.float32) / 255.0
    local = np.asarray(terrain_image.filter(ImageFilter.GaussianBlur(3.0)), dtype=np.float32) / 255.0
    ridge_raw = np.maximum(local - broad, 0.0)
    ridge = normalized(ridge_raw, float(np.percentile(ridge_raw, 67)), float(np.percentile(ridge_raw, 99.4)))
    ridge = np.power(ridge, 0.72)

    gradient_y, gradient_x = np.gradient(elevation)
    slope_raw = np.hypot(gradient_x, gradient_y)
    slope = normalized(slope_raw, float(np.percentile(slope_raw, 8)), float(np.percentile(slope_raw, 98.5)))
    flow, max_accumulation = hydrology_mask(elevation)
    valley = np.power(1.0 - slope, 2.4) * (1.0 - terrain * 0.55)
    valley = np.clip(valley * 0.82 + np.sqrt(flow) * 0.32, 0.0, 1.0)

    packed = np.dstack((flow, ridge, valley))
    stats = {
        "maxFlowAccumulationCells": max_accumulation,
        "flowCoveragePercent": round(float(np.count_nonzero(flow > 0.08)) * 100 / flow.size, 3),
        "ridgeCoveragePercent": round(float(np.count_nonzero(ridge > 0.12)) * 100 / ridge.size, 3),
        "valleyCoveragePercent": round(float(np.count_nonzero(valley > 0.55)) * 100 / valley.size, 3),
    }
    return np.uint8(np.clip(packed * 255, 0, 255)), stats


def projected_to_wgs84(x: float, y: float) -> tuple[float, float]:
    radius = 6378137.0
    longitude = math.degrees(x / radius)
    latitude = math.degrees(2.0 * math.atan(math.exp(y / radius)) - math.pi / 2.0)
    return longitude, latitude


def tile_projected_bounds(column: int, row: int) -> dict[str, float | str]:
    xmin = CENTER_PROJECTED_BOUNDS["xmin"] + column * TILE_WIDTH_M
    xmax = CENTER_PROJECTED_BOUNDS["xmax"] + column * TILE_WIDTH_M
    ymin = CENTER_PROJECTED_BOUNDS["ymin"] - row * TILE_DEPTH_M
    ymax = CENTER_PROJECTED_BOUNDS["ymax"] - row * TILE_DEPTH_M
    return {
        "xmin": round(xmin, 3), "ymin": round(ymin, 3),
        "xmax": round(xmax, 3), "ymax": round(ymax, 3),
        "spatialReference": "EPSG:3857",
    }


def wgs84_bounds(projected: dict[str, float | str]) -> dict[str, float]:
    west, south = projected_to_wgs84(float(projected["xmin"]), float(projected["ymin"]))
    east, north = projected_to_wgs84(float(projected["xmax"]), float(projected["ymax"]))
    return {
        "west": round(west, 8), "south": round(south, 8),
        "east": round(east, 8), "north": round(north, 8),
    }


def export_request(bounds: dict[str, float | str], size: int) -> str:
    parameters = {
        "bbox": f"{bounds['xmin']},{bounds['ymin']},{bounds['xmax']},{bounds['ymax']}",
        "bboxSR": 3857,
        "imageSR": 3857,
        "size": f"{size},{size}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        "adjustAspectRatio": "false",
        "f": "json",
    }
    return f"{SERVICE_URL}?{urlencode(parameters)}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_tiff", type=Path, help="Aligned 3072x3072 USGS source mosaic")
    parser.add_argument("--output", type=Path, default=Path("src/assets/terrain"))
    args = parser.parse_args()

    elevation = np.asarray(Image.open(args.source_tiff), dtype=np.float32)
    expected_shape = (TILE_SIZE * GRID_SIZE, TILE_SIZE * GRID_SIZE)
    if elevation.shape != expected_shape:
        raise ValueError(f"Expected a {expected_shape[1]}x{expected_shape[0]} DEM, received {elevation.shape[::-1]}")
    if not np.isfinite(elevation).all():
        raise ValueError("DEM contains missing or non-finite elevation samples")

    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    minimum = float(elevation.min())
    maximum = float(elevation.max())
    effects, effect_stats = derivative_texture(elevation)
    padded_elevation = np.pad(elevation, GUTTER, mode="edge")
    padded_effects = np.pad(effects, ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode="edge")

    tile_metadata = []
    center_elevation = elevation[TILE_SIZE:TILE_SIZE * 2, TILE_SIZE:TILE_SIZE * 2]
    center_minimum = float(center_elevation.min())
    center_maximum = float(center_elevation.max())

    for tile in TILES:
        x = tile["source_column"] * TILE_SIZE
        y = tile["source_row"] * TILE_SIZE
        tile_elevation = padded_elevation[y:y + TEXTURE_SIZE, x:x + TEXTURE_SIZE]
        tile_effects = padded_effects[y:y + TEXTURE_SIZE, x:x + TEXTURE_SIZE]
        encoded = np.rint(normalized(tile_elevation, minimum, maximum) * 65535).astype("<u2")
        prefix = "monongahela" if tile["id"] == "c" else f"monongahela-{tile['id']}"
        height_name = f"{prefix}-height.r16"
        effects_name = f"{prefix}-effects.png"
        encoded.tofile(output / height_name)
        Image.fromarray(tile_effects, mode="RGB").save(output / effects_name, optimize=True)

        projected = tile_projected_bounds(tile["column"], tile["row"])
        bounds = wgs84_bounds(projected)
        interior = elevation[y:y + TILE_SIZE, x:x + TILE_SIZE]
        tile_metadata.append({
            "id": tile["id"],
            "name": tile["name"],
            "grid": {"column": tile["column"], "row": tile["row"]},
            "bounds": bounds,
            "projectedBounds": projected,
            "observedElevationM": {
                "min": round(float(interior.min()), 4),
                "max": round(float(interior.max()), 4),
            },
            "assets": {"height": height_name, "effects": effects_name},
            "sourceRequest": export_request(projected, TILE_SIZE),
        })

    full_projected = {
        "xmin": round(CENTER_PROJECTED_BOUNDS["xmin"] - TILE_WIDTH_M, 3),
        "ymin": round(CENTER_PROJECTED_BOUNDS["ymin"] - TILE_DEPTH_M, 3),
        "xmax": round(CENTER_PROJECTED_BOUNDS["xmax"] + TILE_WIDTH_M, 3),
        "ymax": round(CENTER_PROJECTED_BOUNDS["ymax"] + TILE_DEPTH_M, 3),
        "spatialReference": "EPSG:3857",
    }
    metadata = {
        "schemaVersion": 2,
        "name": "Monongahela National Forest terrain corridor",
        "tileInteriorSize": TILE_SIZE,
        "textureWidth": TEXTURE_SIZE,
        "textureHeight": TEXTURE_SIZE,
        "textureGutter": GUTTER,
        "byteOrder": "little-endian",
        "encoding": "uint16 normalized to the shared elevation range",
        "minElevationM": round(minimum, 4),
        "maxElevationM": round(maximum, 4),
        "colorElevationRangeM": {"min": round(center_minimum, 4), "max": round(center_maximum, 4)},
        "elevationOriginM": round(center_minimum, 4),
        "metersPerWorldUnit": round((center_maximum - center_minimum) / TERRAIN_HEIGHT, 6),
        "tileWorldSize": TILE_WORLD_SIZE,
        "footprintM": {"width": round(TILE_WIDTH_M * GRID_SIZE, 3), "depth": round(TILE_DEPTH_M * GRID_SIZE, 3)},
        "bounds": wgs84_bounds(full_projected),
        "projectedBounds": full_projected,
        "tiles": tile_metadata,
        "effectsChannels": {
            "red": "D8 flow accumulation",
            "green": "local ridge strength",
            "blue": "low-slope valley suitability",
        },
        "flightPath": {
            "durationSeconds": 120,
            "positions": [[-7.05, 9.55, 16.15], [-5.5, 9.1, 28.0], [-16.0, 8.9, 33.0], [-17.0, 9.3, 17.0], [-7.05, 9.55, 16.15], [-5.8, 9.2, 1.0], [-4.5, 8.9, -16.0]],
            "lookAt": [[2.15, 1.05, -1.35], [1.0, 1.0, 13.0], [-12.0, 1.1, 18.0], [-6.0, 1.0, 2.0], [2.15, 1.05, -1.35], [1.0, 1.0, -14.0], [0.0, 1.0, -27.0]],
        },
        "source": {
            "provider": "U.S. Geological Survey 3D Elevation Program (3DEP)",
            "dataset": "Bare Earth DEM Dynamic Service",
            "request": export_request(full_projected, TILE_SIZE * GRID_SIZE),
            "license": "Public domain; available without use restrictions",
            "retrieved": date.today().isoformat(),
            "sourceProjection": "EPSG:3857",
            "sourcePixelType": "F32",
            "serverResampling": "bilinear",
        },
        "processing": {
            "heightEncoding": "shared min/max normalized unsigned 16-bit integer",
            "heightByteLengthPerTile": TEXTURE_SIZE * TEXTURE_SIZE * 2,
            "derivatives": "Calculated on the complete 3072-square mosaic before guttered tile extraction",
            **effect_stats,
        },
    }
    (output / "monongahela-terrain.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(TILES)} seamless terrain tiles ({minimum:.1f}–{maximum:.1f} m) to {output}")


if __name__ == "__main__":
    main()
