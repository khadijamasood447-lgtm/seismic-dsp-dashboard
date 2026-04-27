from __future__ import annotations

import argparse
import json
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KDTree


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _require_cols(df: pd.DataFrame, cols: List[str], *, name: str) -> None:
  missing = [c for c in cols if c not in df.columns]
  if missing:
    raise SystemExit(f"Missing required columns in {name}: {missing}")


def _to_num(df: pd.DataFrame, cols: List[str]) -> pd.DataFrame:
  out = df.copy()
  for c in cols:
    if c in out.columns:
      out[c] = pd.to_numeric(out[c], errors="coerce")
  return out


def _build_features(df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, Any]]:
  base_cols = [
    "sand_pct",
    "silt_pct",
    "clay_pct",
    "bulk_density",
    "water_content",
    "elevation_m",
    "slope_degrees",
    "course_fragments",
    "land_cover_class",
    "bedrock_depth_m",
    "dist_to_water_m",
    "dist_to_fault_m",
    "topographic_wetness_index",
    "aspect_degrees",
  ]
  _require_cols(df, ["grid_id", "lon", "lat"], name="aoi_grid_complete.csv")
  _require_cols(df, [c for c in base_cols if c != "land_cover_class"], name="aoi_grid_complete.csv")
  if "land_cover_class" not in df.columns:
    df = df.copy()
    df["land_cover_class"] = 0

  df = _to_num(df, base_cols)
  out = df[["grid_id", "lon", "lat"]].copy()
  for c in base_cols:
    out[c] = df[c]

  out["fines_pct"] = out["silt_pct"] + out["clay_pct"]
  out["density_index"] = out["bulk_density"] / (1.0 + (out["water_content"] / 100.0))
  out["sand_fines_ratio"] = out["sand_pct"] / (out["fines_pct"] + 0.01)
  out["water_x_clay"] = out["water_content"] * out["clay_pct"]
  out["elevation_x_slope"] = out["elevation_m"] * out["slope_degrees"]

  numeric_cols = [
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
    "fines_pct",
    "density_index",
    "sand_fines_ratio",
    "water_x_clay",
    "elevation_x_slope",
  ]

  out = _to_num(out, numeric_cols)
  for c in numeric_cols:
    if out[c].isna().any():
      out[c] = out[c].fillna(float(out[c].median()))

  land = pd.to_numeric(out["land_cover_class"], errors="coerce").fillna(0).round().astype(int)
  land_d = pd.get_dummies(land, prefix="land", dtype=np.float64)
  out = pd.concat([out.drop(columns=["land_cover_class"]), land_d], axis=1)

  meta = {
    "numeric_cols": numeric_cols,
    "land_classes": sorted(land_d.columns.tolist()),
    "total_feature_cols": numeric_cols + sorted(land_d.columns.tolist()),
  }
  return out, meta


def _normalize(df: pd.DataFrame, numeric_cols: List[str]) -> Tuple[pd.DataFrame, StandardScaler]:
  scaler = StandardScaler()
  X = df[numeric_cols].to_numpy(dtype=np.float64)
  Xs = scaler.fit_transform(X)
  out = df.copy()
  out[numeric_cols] = Xs
  return out, scaler


def _nearest_grid_join(targets: pd.DataFrame, grid: pd.DataFrame) -> pd.DataFrame:
  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  gx, gy = tx.transform(grid["lon"].to_numpy(dtype=float), grid["lat"].to_numpy(dtype=float))
  tx_x, tx_y = tx.transform(targets["lon"].to_numpy(dtype=float), targets["lat"].to_numpy(dtype=float))
  pts = np.column_stack([gx, gy])
  tree = KDTree(pts)
  dist, ind = tree.query(np.column_stack([tx_x, tx_y]), k=1)
  dist = dist.ravel()
  ind = ind.ravel()
  out = targets.reset_index(drop=True).copy()
  matched = grid.iloc[ind].reset_index(drop=True)
  for c in matched.columns:
    if c in ("grid_id", "lon", "lat"):
      continue
    out[c] = matched[c]
  out["nearest_grid_dist_m"] = dist
  return out


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  models_dir = outputs_dir / "models"
  preds_dir.mkdir(parents=True, exist_ok=True)
  metrics_dir.mkdir(parents=True, exist_ok=True)
  models_dir.mkdir(parents=True, exist_ok=True)

  grid_path = preds_dir / "aoi_grid_complete.csv"
  targets_path = preds_dir / "islamabad_targets_clean.csv"
  if not grid_path.exists() or not targets_path.exists():
    print("Phase 2 FAIL: missing Phase 1 outputs")
    return 2

  grid = pd.read_csv(grid_path)
  targets = pd.read_csv(targets_path)

  features_raw, meta = _build_features(grid)
  numeric_cols = meta["numeric_cols"]
  features_norm, scaler = _normalize(features_raw, numeric_cols)

  feature_cols = [c for c in features_norm.columns if c not in ("grid_id", "lon", "lat")]
  nan_counts = {c: int(pd.to_numeric(features_norm[c], errors="coerce").isna().sum()) for c in feature_cols}
  nan_ok = all(v == 0 for v in nan_counts.values())

  var_ok = True
  var_metrics: Dict[str, Any] = {}
  for c in numeric_cols:
    std = float(np.std(pd.to_numeric(features_norm[c], errors="coerce").to_numpy(dtype=np.float64), ddof=1))
    var_metrics[c] = {"std": std}
    if not (std > 0.01):
      var_ok = False

  land_cols = [c for c in features_norm.columns if c.startswith("land_")]
  land_ok = len(land_cols) >= 1
  if land_ok:
    uniq = int(pd.DataFrame(features_norm[land_cols]).drop_duplicates().shape[0])
    var_metrics["land_cover"] = {"one_hot_cols": len(land_cols), "unique_rows": uniq}
    if uniq <= 1:
      land_ok = False

  ok = bool(nan_ok and var_ok and land_ok)

  out_features = preds_dir / "aoi_features_normalized.csv"
  features_norm.to_csv(out_features, index=False)

  targets = _to_num(targets, ["lon", "lat", "gmax_mpa", "ll", "pl", "pi"])
  targets_features = _nearest_grid_join(targets, features_norm)
  out_targets_features = preds_dir / "bender_features_27.csv"
  targets_features.to_csv(out_targets_features, index=False)

  scaler_path = models_dir / "feature_scaler.pkl"
  with scaler_path.open("wb") as f:
    pickle.dump({"scaler": scaler, "numeric_cols": numeric_cols}, f)

  meta_path = metrics_dir / "phase2_feature_metadata.json"
  meta_path.write_text(json.dumps({"generated_at": _now_iso(), **meta}, indent=2), encoding="utf-8")

  report = {
    "phase": 2,
    "generated_at": _now_iso(),
    "ok": ok,
    "inputs": {"grid": str(grid_path), "targets": str(targets_path)},
    "checks": {
      "no_nans": {"ok": nan_ok, "nan_counts": nan_counts},
      "feature_variance": {"ok": var_ok, "metrics": var_metrics},
      "land_cover_one_hot": {"ok": land_ok, "cols": land_cols},
    },
    "outputs": {
      "aoi_features_normalized_csv": str(out_features),
      "bender_features_27_csv": str(out_targets_features),
      "feature_scaler_pkl": str(scaler_path),
      "feature_metadata_json": str(meta_path),
    },
  }
  (metrics_dir / "phase2_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

  print(f"Phase 2 {'PASS' if ok else 'FAIL'}")
  print(str(out_features))
  print(str(out_targets_features))
  if not ok:
    print("Critical check failed in Phase 2")
    return 2
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
