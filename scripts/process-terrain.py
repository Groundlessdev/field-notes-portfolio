"""Convert a USGS 3DEP float GeoTIFF into web terrain assets.

The export request is intentionally documented here so the checked-in assets can
be reproduced without making any network request in the deployed application.
This script expects the downloaded GeoTIFF as its first argument.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


SOURCE_REQUEST = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/"
    "ImageServer/exportImage?bbox=-8869937.026%2C4667385.084%2C-8822069.645%2C4714512.030"
    "&bboxSR=3857&imageSR=3857&size=1024%2C1024&format=tiff&pixelType=F32"
    "&interpolation=RSP_BilinearInterpolation&adjustAspectRatio=false&f=json"
)

WGS84_BOUNDS = {
    "west": -79.68,
    "south": 38.62,
    "east": -79.25,
    "north": 38.95,
}

PROJECTED_BOUNDS = {
    "xmin": -8869937.026,
    "ymin": 4667385.084,
    "xmax": -8822069.645,
    "ymax": 4714512.030,
    "spatialReference": "EPSG:3857",
}


def normalized(values: np.ndarray, low: float | None = None, high: float | None = None) -> np.ndarray:
    low = float(np.nanmin(values) if low is None else low)
    high = float(np.nanmax(values) if high is None else high)
    return np.clip((values - low) / max(high - low, 1e-9), 0.0, 1.0)


def hydrology_mask(elevation: np.ndarray) -> tuple[np.ndarray, int]:
    """Create a deterministic D8 flow-accumulation mask on a smaller grid."""

    sample_size = 256
    sampled = np.asarray(
        Image.fromarray(elevation.astype(np.float32), mode="F").resize(
            (sample_size, sample_size), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    )
    height, width = sampled.shape
    destination = np.full(height * width, -1, dtype=np.int32)
    neighbors = (
        (-1, -1, 1.4142),
        (0, -1, 1.0),
        (1, -1, 1.4142),
        (-1, 0, 1.0),
        (1, 0, 1.0),
        (-1, 1, 1.4142),
        (0, 1, 1.0),
        (1, 1, 1.4142),
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

    broad = np.asarray(
        terrain_image.filter(ImageFilter.GaussianBlur(12.0)), dtype=np.float32
    ) / 255.0
    local = np.asarray(
        terrain_image.filter(ImageFilter.GaussianBlur(3.0)), dtype=np.float32
    ) / 255.0
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_tiff", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/assets/terrain"),
        help="Output directory relative to the repository root.",
    )
    args = parser.parse_args()

    image = Image.open(args.source_tiff)
    elevation = np.asarray(image, dtype=np.float32)
    if elevation.shape != (1024, 1024):
        raise ValueError(f"Expected a 1024x1024 DEM, received {elevation.shape[::-1]}")
    if not np.isfinite(elevation).all():
        raise ValueError("DEM contains missing or non-finite elevation samples")

    output = args.output
    output.mkdir(parents=True, exist_ok=True)

    minimum = float(elevation.min())
    maximum = float(elevation.max())
    encoded = np.rint(normalized(elevation, minimum, maximum) * 65535).astype("<u2")
    encoded.tofile(output / "monongahela-height.r16")

    effects, effect_stats = derivative_texture(elevation)
    Image.fromarray(effects, mode="RGB").save(
        output / "monongahela-effects.png", optimize=True
    )

    footprint_width = PROJECTED_BOUNDS["xmax"] - PROJECTED_BOUNDS["xmin"]
    footprint_depth = PROJECTED_BOUNDS["ymax"] - PROJECTED_BOUNDS["ymin"]
    metadata = {
        "name": "Spruce Knob–Seneca Rocks, Monongahela National Forest",
        "width": 1024,
        "height": 1024,
        "byteOrder": "little-endian",
        "encoding": "uint16 normalized to the recorded elevation range",
        "minElevationM": round(minimum, 4),
        "maxElevationM": round(maximum, 4),
        "horizontalScaleM": round((footprint_width + footprint_depth) / 2, 3),
        "footprintM": {
            "width": round(footprint_width, 3),
            "depth": round(footprint_depth, 3),
        },
        "bounds": WGS84_BOUNDS,
        "projectedBounds": PROJECTED_BOUNDS,
        "center": {"latitude": 38.785, "longitude": -79.465},
        "verticalScale": 6.5,
        "assets": {
            "height": "monongahela-height.r16",
            "effects": "monongahela-effects.png",
            "effectsChannels": {
                "red": "D8 flow accumulation",
                "green": "local ridge strength",
                "blue": "low-slope valley suitability",
            },
        },
        "source": {
            "provider": "U.S. Geological Survey 3D Elevation Program (3DEP)",
            "dataset": "Bare Earth DEM Dynamic Service",
            "request": SOURCE_REQUEST,
            "license": "Public domain; available without use restrictions",
            "retrieved": date.today().isoformat(),
            "sourceProjection": "EPSG:3857",
            "sourcePixelType": "F32",
            "serverResampling": "bilinear",
        },
        "processing": {
            "heightEncoding": "min/max normalized to unsigned 16-bit integer",
            "heightByteLength": int(encoded.nbytes),
            "derivatives": "D8 flow accumulation at 256², ridge residual, and slope-based valley suitability",
            **effect_stats,
        },
    }
    (output / "monongahela-terrain.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(
        f"Wrote {output} ({minimum:.1f}–{maximum:.1f} m, "
        f"{effect_stats['flowCoveragePercent']}% flow coverage)"
    )


if __name__ == "__main__":
    main()
