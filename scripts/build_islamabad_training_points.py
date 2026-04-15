from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import CRS, Transformer


def _read_points(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    return pd.read_csv(path)


def _as_float_series(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce")


def _sample_layer(ds: rasterio.io.DatasetReader, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    coords = list(zip(xs.tolist(), ys.tolist()))
    vals = []
    for v in ds.sample(coords):
        vals.append(v[0] if len(v) else np.nan)
    out = np.asarray(vals, dtype=float)

    nodata = ds.nodata
    if nodata is not None:
        out = np.where(out == float(nodata), np.nan, out)
    out = np.where(np.isfinite(out), out, np.nan)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--standardized-dir",
        default="data/gis/islamabad_zone1/standardized",
        help="Directory containing standardized GeoTIFF layers",
    )
    ap.add_argument("--points", required=True, help="Input CSV/XLSX with lon/lat columns")
    ap.add_argument("--out", required=True, help="Output CSV path")
    ap.add_argument("--lon-col", default="lon")
    ap.add_argument("--lat-col", default="lat")
    ap.add_argument("--id-col", default=None)
    ap.add_argument(
        "--apply-metadata-scale",
        action="store_true",
        help="Apply _metadata.json scale/offset to sampled values (disabled by default).",
    )
    ap.add_argument(
        "--keep-all-missing",
        action="store_true",
        help="Keep points even if all sampled raster layers are missing (NoData).",
    )
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    std_dir = (root / args.standardized_dir).resolve()
    points_path = (root / args.points).resolve()
    out_path = (root / args.out).resolve()

    rasters = sorted([p for p in std_dir.glob("*.tif") if p.name != "_index.tif"])
    if not rasters:
        raise SystemExit(f"No .tif files found in {std_dir}")

    layer_scale: dict[str, tuple[float, float]] = {}
    if args.apply_metadata_scale:
        meta_path = std_dir / "_metadata.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            for layer in meta.get("layers", []):
                layer_id = str(layer.get("id", "")).strip()
                if not layer_id:
                    continue
                scale = float(layer.get("scale", 1.0) or 1.0)
                offset = float(layer.get("offset", 0.0) or 0.0)
                layer_scale[layer_id] = (scale, offset)

    df = _read_points(points_path)
    if args.lon_col not in df.columns or args.lat_col not in df.columns:
        raise SystemExit(
            f"Points file must include columns '{args.lon_col}' and '{args.lat_col}'. Found: {list(df.columns)}"
        )

    lon = _as_float_series(df, args.lon_col).to_numpy(dtype=float)
    lat = _as_float_series(df, args.lat_col).to_numpy(dtype=float)
    if np.isnan(lon).any() or np.isnan(lat).any():
        raise SystemExit("Found non-numeric lon/lat rows; fix the input file before sampling.")

    with rasterio.open(rasters[0]) as ref:
        dst_crs = CRS.from_user_input(ref.crs)

    transformer = Transformer.from_crs(CRS.from_epsg(4326), dst_crs, always_xy=True)
    xs, ys = transformer.transform(lon.tolist(), lat.tolist())
    xs = np.asarray(xs, dtype=float)
    ys = np.asarray(ys, dtype=float)

    out_df = df.copy()
    out_df["x"] = xs
    out_df["y"] = ys

    for p in rasters:
        layer_id = p.stem
        with rasterio.open(p) as ds:
            vals = _sample_layer(ds, xs, ys)

        if layer_id in layer_scale:
            scale, offset = layer_scale[layer_id]
            if scale != 0:
                vals = (vals / scale) - offset

        out_df[layer_id] = vals

    layer_cols = [p.stem for p in rasters]
    all_missing = out_df[layer_cols].isna().all(axis=1)
    if bool(all_missing.any()) and not args.keep_all_missing:
        out_df = out_df.loc[~all_missing].copy()

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out_path, index=False)
    print(str(out_path))


if __name__ == "__main__":
    main()
