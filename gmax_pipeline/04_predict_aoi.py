from __future__ import annotations

import argparse
import json
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
import rasterio
from pyproj import CRS, Transformer
from rasterio.transform import rowcol


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _z80() -> float:
  return 1.2815515655446004


def _load_model(path: Path) -> Dict[str, Any]:
  with path.open("rb") as f:
    obj = pickle.load(f)
  if not isinstance(obj, dict) or "models" not in obj or "feature_cols" not in obj:
    raise RuntimeError("Unexpected model artifact format")
  return obj


def _predict_ensemble_log(models: List[Any], X: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
  preds = np.stack([m.predict(X).astype(np.float64) for m in models], axis=0)
  mean = np.mean(preds, axis=0)
  std = np.std(preds, axis=0, ddof=1) if preds.shape[0] > 1 else np.zeros(mean.shape[0], dtype=np.float64)
  return mean.astype(np.float64), std.astype(np.float64)


def _to_raster(
  template_path: Path,
  lon: np.ndarray,
  lat: np.ndarray,
  values: np.ndarray,
  out_path: Path,
  *,
  nodata: float = -9999.0,
) -> None:
  with rasterio.open(template_path) as ds:
    if ds.crs is None:
      raise RuntimeError(f"Template raster has no CRS: {template_path}")
    crs = CRS.from_user_input(ds.crs)

    if crs == CRS.from_epsg(4326):
      xs = lon
      ys = lat
    else:
      tx = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
      xs, ys = tx.transform(lon.tolist(), lat.tolist())
      xs = np.asarray(xs, dtype=np.float64)
      ys = np.asarray(ys, dtype=np.float64)

    rows, cols = rowcol(ds.transform, xs, ys)
    rows = np.asarray(rows)
    cols = np.asarray(cols)
    ok = (rows >= 0) & (rows < ds.height) & (cols >= 0) & (cols < ds.width) & np.isfinite(values)

    arr = np.full((ds.height, ds.width), float(nodata), dtype=np.float32)
    arr[rows[ok], cols[ok]] = values[ok].astype(np.float32)

    profile = ds.profile.copy()
    profile.update(
      {
        "count": 1,
        "dtype": "float32",
        "nodata": float(nodata),
        "compress": "lzw",
      }
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out_path, "w", **profile) as dst:
      dst.write(arr, 1)


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--model", default=str(REPO_ROOT / "outputs" / "models" / "model_ensemble_5_vs30weak.pkl"))
  ap.add_argument("--template", default=str(REPO_ROOT / "ISLAMABD DATA" / "sand content.tif"))
  ap.add_argument("--min_gmax", type=float, default=1.0)
  ap.add_argument("--max_gmax", type=float, default=500.0)
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  preds_dir.mkdir(parents=True, exist_ok=True)
  metrics_dir.mkdir(parents=True, exist_ok=True)

  features_path = preds_dir / "aoi_features_normalized.csv"
  raw_grid_path = preds_dir / "aoi_grid_complete.csv"
  if not features_path.exists() or not raw_grid_path.exists():
    print("Phase 4 FAIL: missing Phase 1/2 outputs")
    return 2

  model_path = Path(args.model).resolve()
  if not model_path.exists():
    print(f"Phase 4 FAIL: missing model artifact: {model_path}")
    return 2

  template_path = Path(args.template).resolve()
  if not template_path.exists():
    print(f"Phase 4 FAIL: missing template raster: {template_path}")
    return 2

  feat = pd.read_csv(features_path)
  raw = pd.read_csv(raw_grid_path)
  if "grid_id" in raw.columns and "grid_id" in feat.columns:
    merged = raw.merge(feat, on=["grid_id", "lon", "lat"], how="inner", suffixes=("_raw", ""))
  else:
    merged = feat.copy()

  obj = _load_model(model_path)
  models = obj["models"]
  feature_cols: List[str] = list(obj["feature_cols"])
  target_desc = str(obj.get("target") or "")
  if "log1p" not in target_desc:
    raise RuntimeError("Expected model to be trained on log1p(gmax_mpa)")

  missing = [c for c in feature_cols if c not in merged.columns]
  if missing:
    print(f"Phase 4 FAIL: missing required feature columns in AOI features: {missing}")
    return 2

  X = merged[feature_cols].apply(pd.to_numeric, errors="coerce")
  for c in feature_cols:
    if X[c].isna().any():
      X[c] = X[c].fillna(float(X[c].median()))
  X_np = X.to_numpy(dtype=np.float32)

  mean_log, std_log = _predict_ensemble_log(models, X_np)
  z = _z80()

  mean_mpa = np.expm1(mean_log)
  p10_mpa = np.expm1(mean_log - z * std_log)
  p90_mpa = np.expm1(mean_log + z * std_log)

  mean_mpa = np.clip(mean_mpa, float(args.min_gmax), float(args.max_gmax))
  p10_mpa = np.clip(p10_mpa, float(args.min_gmax), float(args.max_gmax))
  p90_mpa = np.clip(p90_mpa, float(args.min_gmax), float(args.max_gmax))
  std_mpa = np.maximum(0.0, (p90_mpa - p10_mpa) / (2.0 * z))

  clay = pd.to_numeric(merged.get("clay_pct", np.nan), errors="coerce").to_numpy(dtype=np.float64)
  ll_pred = 20.0 + 0.5 * clay
  pl_pred = 15.0 + 0.3 * clay
  ll_pred = np.where(np.isfinite(ll_pred), ll_pred, np.nan)
  pl_pred = np.where(np.isfinite(pl_pred), pl_pred, np.nan)

  out = pd.DataFrame(
    {
      "lon": pd.to_numeric(merged["lon"], errors="coerce"),
      "lat": pd.to_numeric(merged["lat"], errors="coerce"),
      "gmax_mpa_predicted": mean_mpa,
      "gmax_mpa_p10": p10_mpa,
      "gmax_mpa_p90": p90_mpa,
      "gmax_mpa_std": std_mpa,
      "ll_predicted": ll_pred,
      "pl_predicted": pl_pred,
    }
  )

  for c in [
    "sand_pct",
    "silt_pct",
    "clay_pct",
    "bulk_density",
    "water_content",
    "elevation_m",
    "slope_degrees",
    "course_fragments",
    "bedrock_depth_m",
    "dist_to_water_m",
    "dist_to_fault_m",
    "topographic_wetness_index",
    "aspect_degrees",
  ]:
    if c in merged.columns:
      out[c] = merged[c]

  for c in feature_cols:
    out[f"feat_{c}"] = merged[c]

  out_path = preds_dir / "aoi_predictions_final.csv"
  out.to_csv(out_path, index=False)

  tif_mean = preds_dir / "gmax_2m_predicted.tif"
  tif_std = preds_dir / "gmax_2m_uncertainty.tif"
  tif_p10 = preds_dir / "gmax_2m_p10.tif"
  tif_p90 = preds_dir / "gmax_2m_p90.tif"
  lon = out["lon"].to_numpy(dtype=np.float64)
  lat = out["lat"].to_numpy(dtype=np.float64)
  _to_raster(template_path, lon, lat, out["gmax_mpa_predicted"].to_numpy(dtype=np.float64), tif_mean)
  _to_raster(template_path, lon, lat, out["gmax_mpa_std"].to_numpy(dtype=np.float64), tif_std)
  _to_raster(template_path, lon, lat, out["gmax_mpa_p10"].to_numpy(dtype=np.float64), tif_p10)
  _to_raster(template_path, lon, lat, out["gmax_mpa_p90"].to_numpy(dtype=np.float64), tif_p90)

  report = {
    "phase": 4,
    "generated_at": _now_iso(),
    "ok": True,
    "inputs": {
      "features": str(features_path),
      "grid_raw": str(raw_grid_path),
      "model": str(model_path),
      "template": str(template_path),
    },
    "outputs": {
      "aoi_predictions_final_csv": str(out_path),
      "gmax_2m_predicted_tif": str(tif_mean),
      "gmax_2m_uncertainty_tif": str(tif_std),
      "gmax_2m_p10_tif": str(tif_p10),
      "gmax_2m_p90_tif": str(tif_p90),
    },
    "summary": {"points": int(len(out)), "pi": "80% via ensemble log-std"},
  }
  (metrics_dir / "phase4_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

  print("Phase 4 PASS")
  print(str(out_path))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
