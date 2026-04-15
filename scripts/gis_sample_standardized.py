from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import CRS, Transformer


def sample_raster_at_xy(ds: rasterio.io.DatasetReader, x: float, y: float) -> float | None:
    row, col = ds.index(x, y)
    if row < 0 or col < 0 or row >= ds.height or col >= ds.width:
        return None
    val = ds.read(1, window=((row, row + 1), (col, col + 1)))[0, 0]
    nodata = ds.nodata
    if nodata is not None and float(val) == float(nodata):
        return None
    if isinstance(val, (np.floating, float)) and not np.isfinite(val):
        return None
    return float(val)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--standardized-dir", required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--lat", type=float, required=True)
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    std_dir = (root / args.standardized_dir).resolve()
    rasters = sorted([p for p in std_dir.glob("*.tif") if p.name != "_index.tif"])

    if not rasters:
        raise SystemExit(f"No .tif files found in {std_dir}")

    with rasterio.open(rasters[0]) as ref:
        dst_crs = CRS.from_user_input(ref.crs)

    transformer = Transformer.from_crs(CRS.from_epsg(4326), dst_crs, always_xy=True)
    x, y = transformer.transform(args.lon, args.lat)

    out: dict[str, Any] = {
        "input": {"lon": args.lon, "lat": args.lat},
        "projected": {"x": x, "y": y, "crs": dst_crs.to_string()},
        "values": {},
    }

    for p in rasters:
        layer_id = p.stem
        with rasterio.open(p) as ds:
            out["values"][layer_id] = sample_raster_at_xy(ds, x, y)

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()

