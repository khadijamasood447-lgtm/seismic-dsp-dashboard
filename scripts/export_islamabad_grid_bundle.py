from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio


def _read_raster(path: Path) -> tuple[np.ndarray, dict]:
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float32")
        nodata = ds.nodata
        if nodata is not None:
            arr = np.where(arr == float(nodata), np.nan, arr)
        profile = ds.profile
    arr = np.where(np.isfinite(arr), arr, np.nan)
    return arr, profile


def _to_jsonable(arr: np.ndarray) -> list[float | None]:
    flat = arr.reshape(-1)
    out: list[float | None] = []
    for v in flat.tolist():
        if v is None:
            out.append(None)
        else:
            fv = float(v)
            out.append(fv if np.isfinite(fv) else None)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--standardized-dir",
        default="data/gis/islamabad_zone1/standardized",
        help="Folder containing standardized rasters + _metadata.json",
    )
    ap.add_argument(
        "--predictions-dir",
        default="data/training/islamabad_v1/be_model_v1/predictions",
        help="Folder containing pred_*.tif rasters (optional)",
    )
    ap.add_argument(
        "--out",
        default="data/gis/islamabad_zone1/islamabad_grid_bundle.json",
        help="Output JSON bundle path",
    )
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    std_dir = (root / args.standardized_dir).resolve()
    pred_dir = (root / args.predictions_dir).resolve()
    out_path = (root / args.out).resolve()

    meta_path = std_dir / "_metadata.json"
    if not meta_path.exists():
        raise SystemExit(f"Missing _metadata.json at {meta_path}")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    grid = meta.get("grid", {})
    shape = grid.get("shape", {})
    height = int(shape.get("height"))
    width = int(shape.get("width"))
    bounds = grid.get("bounds", {})
    transform = grid.get("transform")

    if not (height > 0 and width > 0 and isinstance(transform, list) and len(transform) == 6):
        raise SystemExit("Invalid grid metadata in _metadata.json")

    layer_files: dict[str, Path] = {}
    for p in sorted(std_dir.glob("*.tif")):
        if p.name == "_index.tif":
            continue
        layer_files[p.stem] = p

    if pred_dir.exists():
        for p in sorted(pred_dir.glob("pred_*.tif")):
            key = p.stem
            layer_files[key] = p

    if not layer_files:
        raise SystemExit(f"No layers found under {std_dir}")

    layers: dict[str, dict] = {}
    profile_ref: dict | None = None

    for key, p in layer_files.items():
        arr, profile = _read_raster(p)
        if arr.shape != (height, width):
            raise SystemExit(f"Layer {p} has shape {arr.shape}, expected {(height, width)}")
        if profile_ref is None:
            profile_ref = profile
        layers[key] = {"values": _to_jsonable(arr)}

    bundle = {
        "crs": grid.get("crs"),
        "transform": transform,
        "width": width,
        "height": height,
        "bounds": bounds,
        "layers": layers,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()

