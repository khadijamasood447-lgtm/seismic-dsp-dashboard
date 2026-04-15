from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio


def _read_band(path: Path) -> tuple[np.ndarray, dict]:
    with rasterio.open(path) as ds:
        arr = ds.read(1).astype("float32")
        nodata = ds.nodata
        if nodata is not None:
            arr = np.where(arr == float(nodata), np.nan, arr)
        profile = ds.profile
    arr = np.where(np.isfinite(arr), arr, np.nan)
    return arr, profile


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True, help="Folder containing models/*.joblib and report.json")
    ap.add_argument(
        "--standardized-dir",
        default="data/gis/islamabad_zone1/standardized",
        help="Directory containing standardized GeoTIFF layers",
    )
    ap.add_argument(
        "--out-dir",
        required=True,
        help="Output folder for predicted GeoTIFFs",
    )
    ap.add_argument(
        "--points",
        default=None,
        help="Optional sampled points CSV (to validate predictions at test locations)",
    )
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    model_dir = (root / args.model_dir).resolve()
    std_dir = (root / args.standardized_dir).resolve()
    out_dir = (root / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    report_path = model_dir / "report.json"
    if not report_path.exists():
        raise SystemExit(f"Missing report.json in {model_dir}")

    report = json.loads(report_path.read_text(encoding="utf-8"))
    features: list[str] = list(report.get("features", []))
    targets: list[str] = list(report.get("targets", {}).keys())
    if not features:
        raise SystemExit("No feature list found in report.json")
    if not targets:
        raise SystemExit("No targets found in report.json")

    try:
        import joblib  # type: ignore
    except Exception as e:
        raise SystemExit(f"Missing dependency 'joblib': {e}")

    meta_path = std_dir / "_metadata.json"
    if not meta_path.exists():
        raise SystemExit(f"Missing _metadata.json in {std_dir}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    grid = meta.get("grid", {})
    transform = grid.get("transform")
    shape = grid.get("shape", {})
    h = int(shape.get("height"))
    w = int(shape.get("width"))
    if not (isinstance(transform, list) and len(transform) == 6 and h > 0 and w > 0):
        raise SystemExit("Invalid grid metadata")

    pixel_w = float(transform[0])
    origin_x = float(transform[2])
    pixel_h = float(transform[4])
    origin_y = float(transform[5])

    cols = np.arange(w, dtype=float)
    rows = np.arange(h, dtype=float)
    lon_grid = origin_x + (cols + 0.5) * pixel_w
    lat_grid = origin_y + (rows + 0.5) * pixel_h
    lon2d, lat2d = np.meshgrid(lon_grid, lat_grid)

    profile_ref: dict | None = None
    layer_arrays: dict[str, np.ndarray] = {}

    for p in sorted(std_dir.glob("*.tif")):
        if p.name == "_index.tif":
            continue
        arr, prof = _read_band(p)
        layer_arrays[p.stem] = arr
        if profile_ref is None:
            profile_ref = prof

    assert profile_ref is not None

    subbasin_path = std_dir / "subbasins_runoff.csv"
    sub_features: dict[str, np.ndarray] = {}
    if subbasin_path.exists() and any(f.startswith("sub_") for f in features):
        sub = pd.read_csv(subbasin_path)
        sub = sub.rename(columns={c: str(c).strip() for c in sub.columns})
        sub_lon = pd.to_numeric(sub.get("Longitude"), errors="coerce").to_numpy(dtype=float)
        sub_lat = pd.to_numeric(sub.get("Latitude"), errors="coerce").to_numpy(dtype=float)

        def depth_mean(v: Any) -> float | None:
            s = str(v).strip()
            if s == "":
                return None
            if "-" in s:
                a, b = s.split("-", 1)
                try:
                    return (float(a) + float(b)) / 2.0
                except Exception:
                    return None
            try:
                return float(s)
            except Exception:
                return None

        sub_rc = pd.to_numeric(sub.get("Runoff_Class"), errors="coerce").to_numpy(dtype=float)
        sub_rd = sub.get("Runoff_Depth_mm").map(depth_mean).astype(float).to_numpy(dtype=float)
        sub_min = pd.to_numeric(sub.get("Min_Elev_m"), errors="coerce").to_numpy(dtype=float)
        sub_max = pd.to_numeric(sub.get("Max_Elev_m"), errors="coerce").to_numpy(dtype=float)
        sub_area = pd.to_numeric(sub.get("Area_km2"), errors="coerce").to_numpy(dtype=float)

        pts = np.column_stack([sub_lon, sub_lat])
        ok_pts = np.isfinite(pts).all(axis=1)
        pts = pts[ok_pts]
        sub_rc = sub_rc[ok_pts]
        sub_rd = sub_rd[ok_pts]
        sub_min = sub_min[ok_pts]
        sub_max = sub_max[ok_pts]
        sub_area = sub_area[ok_pts]

        def idw_field(values: np.ndarray, k: int = 5, power: float = 2.0) -> np.ndarray:
            out = np.full((h, w), np.nan, dtype="float32")
            if pts.size == 0:
                return out
            for rr in range(h):
                for cc in range(w):
                    lon = float(lon2d[rr, cc])
                    lat = float(lat2d[rr, cc])
                    dx = pts[:, 0] - lon
                    dy = pts[:, 1] - lat
                    d2 = dx * dx + dy * dy
                    order = np.argsort(d2)[: min(k, d2.size)]
                    vv = values[order]
                    dd = d2[order]
                    if dd.size == 0:
                        continue
                    if float(dd[0]) == 0.0 and np.isfinite(float(vv[0])):
                        out[rr, cc] = float(vv[0])
                        continue
                    wts = 1.0 / (np.power(dd, power / 2.0) + 1e-12)
                    ok = np.isfinite(vv) & np.isfinite(wts)
                    if not bool(ok.any()):
                        continue
                    vv = vv[ok]
                    wts = wts[ok]
                    wts = wts / float(wts.sum())
                    out[rr, cc] = float(np.sum(vv * wts))
            return out

        sub_features["sub_runoff_class"] = np.rint(idw_field(sub_rc)).astype("float32")
        sub_features["sub_runoff_depth_mm_mean"] = idw_field(sub_rd)
        sub_features["sub_min_elev_m"] = idw_field(sub_min)
        sub_features["sub_max_elev_m"] = idw_field(sub_max)
        sub_features["sub_area_km2"] = idw_field(sub_area)

    cols_data: dict[str, np.ndarray] = {}
    for f in features:
        if f in layer_arrays:
            cols_data[f] = layer_arrays[f]
            continue
        if f in sub_features:
            cols_data[f] = sub_features[f]
            continue
        cols_data[f] = np.full((h, w), np.nan, dtype="float32")

    X_arr = np.stack([cols_data[f] for f in features], axis=-1).reshape(-1, len(features))
    mask_all_nan = np.isnan(X_arr).all(axis=1)
    X = pd.DataFrame(X_arr, columns=features)

    out_profile = profile_ref.copy()
    out_profile.update(
        {
            "count": 1,
            "dtype": "float32",
            "nodata": -9999.0,
        }
    )

    for target in targets:
        model_path = model_dir / "models" / f"{target}.joblib"
        if not model_path.exists():
            continue

        model = joblib.load(model_path)
        preds = model.predict(X)
        preds = np.asarray(preds, dtype="float32")
        preds = np.where(mask_all_nan, out_profile["nodata"], preds)
        out_arr = preds.reshape(h, w)

        out_path = out_dir / f"pred_{target}.tif"
        with rasterio.open(out_path, "w", **out_profile) as ds:
            ds.write(out_arr, 1)

    if args.points:
        points_path = (root / args.points).resolve()
        pts = pd.read_csv(points_path)
        Xp = pts[features].copy()

        rows: list[dict] = []
        for target in targets:
            model_path = model_dir / "models" / f"{target}.joblib"
            if not model_path.exists() or target not in pts.columns:
                continue
            model = joblib.load(model_path)
            y_true = pd.to_numeric(pts[target], errors="coerce").to_numpy(dtype=float)
            y_pred = model.predict(Xp)
            for i in range(len(pts)):
                rows.append(
                    {
                        "target": target,
                        "site_id": pts.get("site_id", pd.Series([""] * len(pts))).iloc[i],
                        "lon": pts.get("lon", pd.Series([np.nan] * len(pts))).iloc[i],
                        "lat": pts.get("lat", pd.Series([np.nan] * len(pts))).iloc[i],
                        "y_true": y_true[i],
                        "y_pred": float(y_pred[i]) if np.isfinite(y_pred[i]) else np.nan,
                        "abs_err": float(abs(y_true[i] - y_pred[i])) if np.isfinite(y_true[i]) and np.isfinite(y_pred[i]) else np.nan,
                    }
                )

        if rows:
            out_points = out_dir / "point_validation.csv"
            pd.DataFrame(rows).to_csv(out_points, index=False)


if __name__ == "__main__":
    main()
