from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from shapely.geometry import shape


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _save(fig: plt.Figure, out_path: Path) -> None:
  out_path.parent.mkdir(parents=True, exist_ok=True)
  fig.tight_layout()
  fig.savefig(out_path, dpi=300)
  plt.close(fig)


def _parse_vs30_table(xlsx_path: Path) -> pd.DataFrame:
  raw = pd.read_excel(xlsx_path, header=None)
  header_row = None
  for i in range(min(60, len(raw))):
    row = raw.iloc[i].astype(str).str.lower().tolist()
    if any("longitude" in c for c in row) and any("latitude" in c for c in row) and any("vs30" in c for c in row):
      header_row = i
      break
  if header_row is None:
    raise RuntimeError("Could not locate VS30 header row in XLSX")
  df = pd.read_excel(xlsx_path, header=header_row)
  cols = {str(c).lower().strip(): c for c in df.columns}
  lon_col = next((v for k, v in cols.items() if "longitude" in k), None)
  lat_col = next((v for k, v in cols.items() if "latitude" in k), None)
  vs_col = next((v for k, v in cols.items() if "vs30" in k), None)
  if lon_col is None or lat_col is None or vs_col is None:
    raise RuntimeError("VS30 XLSX missing Longitude/Latitude/VS30 columns")
  out = pd.DataFrame(
    {
      "lon": pd.to_numeric(df[lon_col], errors="coerce"),
      "lat": pd.to_numeric(df[lat_col], errors="coerce"),
      "vs30_m_s": pd.to_numeric(df[vs_col], errors="coerce"),
    }
  )
  out = out.dropna(subset=["lon", "lat", "vs30_m_s"]).reset_index(drop=True)
  out = out[(out["lat"].between(-90, 90)) & (out["lon"].between(-180, 180))].reset_index(drop=True)
  return out


def _load_aoi_polygon(path: Path) -> Any:
  obj = json.loads(path.read_text(encoding="utf-8"))
  geom = obj["features"][0]["geometry"]
  return shape(geom)


def _fig_study_area(out_dir: Path, aoi_path: Path, bender_path: Path, vs30_xlsx: Path) -> Path:
  aoi = _load_aoi_polygon(aoi_path)
  bender = pd.read_csv(bender_path)
  vs30 = _parse_vs30_table(vs30_xlsx)

  fig = plt.figure(figsize=(7.2, 6.0))
  ax = fig.add_subplot(1, 1, 1)

  x, y = aoi.exterior.xy
  ax.plot(x, y, linewidth=2)
  ax.fill(x, y, alpha=0.08)

  ax.scatter(vs30["lon"], vs30["lat"], s=12, alpha=0.6, label=f"Vs30 points (n={len(vs30)})")
  ax.scatter(bender["lon"], bender["lat"], s=35, label=f"Bender points (n={len(bender)})")

  ax.set_title("Study Area: AOI, Bender Tests, Vs30 Measurements")
  ax.set_xlabel("Longitude")
  ax.set_ylabel("Latitude")
  ax.legend(loc="best", frameon=True)

  out_path = out_dir / "fig01_study_area.png"
  _save(fig, out_path)
  return out_path


def _fig_feature_distributions(out_dir: Path, grid_path: Path) -> Path:
  df = pd.read_csv(grid_path)
  cols = [
    "sand_pct",
    "silt_pct",
    "clay_pct",
    "bulk_density",
    "water_content",
    "elevation_m",
    "bedrock_depth_m",
    "dist_to_water_m",
    "dist_to_fault_m",
  ]
  cols = [c for c in cols if c in df.columns]
  df = df[cols].apply(pd.to_numeric, errors="coerce")

  n = len(cols)
  r = int(math.ceil(n / 3))
  fig = plt.figure(figsize=(12.0, 3.2 * r))
  for i, c in enumerate(cols, start=1):
    ax = fig.add_subplot(r, 3, i)
    v = df[c].to_numpy(dtype=np.float64)
    v = v[np.isfinite(v)]
    ax.hist(v, bins=30)
    ax.set_title(c)
  out_path = out_dir / "fig02_feature_distributions.png"
  _save(fig, out_path)
  return out_path


def _infer_bulk_density_g_cm3(v: float) -> float:
  if not math.isfinite(v):
    return float("nan")
  if v > 20.0:
    return v * 0.01
  return v


def _fig_target_distribution(out_dir: Path, bender_path: Path, grid_raw_path: Path, aoi_features_path: Path, vs30_xlsx: Path) -> Path:
  bender = pd.read_csv(bender_path)
  y = pd.to_numeric(bender.get("gmax_mpa"), errors="coerce").to_numpy(dtype=np.float64)
  y = y[np.isfinite(y)]

  grid_raw = pd.read_csv(grid_raw_path)
  features = pd.read_csv(aoi_features_path)
  vs30 = _parse_vs30_table(vs30_xlsx)
  from pyproj import Transformer
  from sklearn.neighbors import KDTree

  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  gx, gy = tx.transform(features["lon"].to_numpy(dtype=float), features["lat"].to_numpy(dtype=float))
  vx, vy = tx.transform(vs30["lon"].to_numpy(dtype=float), vs30["lat"].to_numpy(dtype=float))
  tree = KDTree(np.column_stack([gx, gy]))
  dist, ind = tree.query(np.column_stack([vx, vy]), k=1)
  ind = ind.ravel()
  bd = pd.to_numeric(grid_raw.iloc[ind].get("bulk_density"), errors="coerce").to_numpy(dtype=np.float64)
  bd = np.array([_infer_bulk_density_g_cm3(float(x)) for x in bd], dtype=np.float64)
  vs = vs30["vs30_m_s"].to_numpy(dtype=np.float64)
  g_proxy = (bd * (vs * vs)) / 1000.0
  g_proxy = np.where(np.isfinite(g_proxy), g_proxy, np.nan)
  g_proxy = g_proxy[np.isfinite(g_proxy)]

  fig = plt.figure(figsize=(8.0, 5.0))
  ax = fig.add_subplot(1, 1, 1)
  ax.hist(y, bins=15, alpha=0.7, label=f"Bender Gmax (n={len(y)})")
  if len(g_proxy):
    ax.hist(g_proxy, bins=25, alpha=0.5, label=f"Vs30-derived proxy (n={len(g_proxy)})")
  ax.set_title("Target Distribution")
  ax.set_xlabel("Gmax (MPa)")
  ax.set_ylabel("Count")
  ax.legend(loc="best")

  out_path = out_dir / "fig03_target_distribution.png"
  _save(fig, out_path)
  return out_path


def _fig_corr_heatmap(out_dir: Path, bender_features_path: Path) -> Path:
  df = pd.read_csv(bender_features_path)
  drop = {"sector", "lon", "lat", "ll", "pl", "pi", "nearest_grid_dist_m"}
  cols = [c for c in df.columns if c not in drop]
  df = df[cols].apply(pd.to_numeric, errors="coerce")
  corr = df.corr(numeric_only=True)

  fig = plt.figure(figsize=(10.5, 9.0))
  ax = fig.add_subplot(1, 1, 1)
  im = ax.imshow(corr.to_numpy(), vmin=-1, vmax=1)
  ax.set_xticks(range(corr.shape[1]))
  ax.set_yticks(range(corr.shape[0]))
  ax.set_xticklabels(corr.columns, rotation=90, fontsize=7)
  ax.set_yticklabels(corr.index, fontsize=7)
  fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
  ax.set_title("Correlation Heatmap (Bender Feature Table)")

  out_path = out_dir / "fig04_correlation_heatmap.png"
  _save(fig, out_path)
  return out_path


def _fig_pred_vs_actual(out_dir: Path, csv_path: Path) -> Path:
  df = pd.read_csv(csv_path)
  y = pd.to_numeric(df.get("gmax_actual_mpa"), errors="coerce").to_numpy(dtype=np.float64)
  p = pd.to_numeric(df.get("gmax_pred_layer_mpa"), errors="coerce").to_numpy(dtype=np.float64)
  m = np.isfinite(y) & np.isfinite(p)
  y = y[m]
  p = p[m]

  fig = plt.figure(figsize=(6.6, 5.6))
  ax = fig.add_subplot(1, 1, 1)
  ax.scatter(y, p, s=40)
  lo = float(min(np.min(y), np.min(p)))
  hi = float(max(np.max(y), np.max(p)))
  ax.plot([lo, hi], [lo, hi])
  ax.set_title("Predicted vs Actual (Islamabad Layer @ Bender Points)")
  ax.set_xlabel("Actual Gmax (MPa)")
  ax.set_ylabel("Predicted Gmax (MPa)")

  out_path = out_dir / "fig05_pred_vs_actual.png"
  _save(fig, out_path)
  return out_path


def _render_tif(out_dir: Path, tif_path: Path, title: str, out_name: str, vmin: float | None = None, vmax: float | None = None) -> Path:
  with rasterio.open(tif_path) as ds:
    arr = ds.read(1).astype(np.float64)
    nodata = ds.nodata
    if nodata is not None:
      arr = np.where(arr == float(nodata), np.nan, arr)
    arr = np.where(np.isfinite(arr), arr, np.nan)

  fig = plt.figure(figsize=(8.0, 6.0))
  ax = fig.add_subplot(1, 1, 1)
  im = ax.imshow(arr, vmin=vmin, vmax=vmax)
  ax.set_title(title)
  ax.set_xticks([])
  ax.set_yticks([])
  fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
  out_path = out_dir / out_name
  _save(fig, out_path)
  return out_path


def _fig_baseline_comparison(out_dir: Path, validation_path: Path) -> Path:
  obj = json.loads(validation_path.read_text(encoding="utf-8"))
  comps = obj.get("comparisons", {})
  names = ["mean", "ridge", "xgb_single", "vs30weak_ensemble"]
  vals = []
  for n in names:
    rmse = comps.get(n, {}).get("practical", {}).get("rmse_mean")
    vals.append(float(rmse) if rmse is not None else float("nan"))

  fig = plt.figure(figsize=(7.4, 4.6))
  ax = fig.add_subplot(1, 1, 1)
  ax.bar(names, vals)
  ax.set_title("Baseline Comparison (Practical 1 km CV)")
  ax.set_ylabel("RMSE (MPa)")
  ax.set_ylim(0, max([v for v in vals if np.isfinite(v)] + [1.0]) * 1.2)
  out_path = out_dir / "fig12_baseline_comparison.png"
  _save(fig, out_path)
  return out_path


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--vs30-xlsx", default=str(REPO_ROOT / "ISLAMABD DATA" / "Table3_VS30.xlsx"))
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  pred_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  fig_dir = outputs_dir / "figures"
  fig_dir.mkdir(parents=True, exist_ok=True)

  aoi_path = pred_dir / "aoi_polygon.geojson"
  bender_path = pred_dir / "islamabad_targets_clean.csv"
  grid_path = pred_dir / "aoi_grid_complete.csv"
  feat_path = pred_dir / "aoi_features_normalized.csv"
  bender_features_path = pred_dir / "bender_features_27.csv"
  pred_vs_actual_csv = metrics_dir / "bender_pred_vs_actual_layer.csv"
  validation_path = metrics_dir / "validation_report.json"
  gmax_mean_tif = pred_dir / "gmax_2m_predicted.tif"
  gmax_std_tif = pred_dir / "gmax_2m_uncertainty.tif"

  required = [aoi_path, bender_path, grid_path, feat_path, bender_features_path, validation_path, gmax_mean_tif, gmax_std_tif]
  missing = [str(p) for p in required if not p.exists()]
  if missing:
    raise SystemExit(f"Missing required artifacts: {missing}")

  written: List[str] = []
  written.append(str(_fig_study_area(fig_dir, aoi_path, bender_path, Path(args.vs30_xlsx))))
  written.append(str(_fig_feature_distributions(fig_dir, grid_path)))
  written.append(str(_fig_target_distribution(fig_dir, bender_path, grid_path, feat_path, Path(args.vs30_xlsx))))
  written.append(str(_fig_corr_heatmap(fig_dir, bender_features_path)))
  if pred_vs_actual_csv.exists():
    written.append(str(_fig_pred_vs_actual(fig_dir, pred_vs_actual_csv)))
  written.append(str(_render_tif(fig_dir, gmax_mean_tif, "Gmax Map (2 m) — Mean", "fig08_gmax_map.png", vmin=1.0, vmax=200.0)))
  written.append(str(_render_tif(fig_dir, gmax_std_tif, "Gmax Uncertainty (2 m) — Std", "fig09_uncertainty_map.png")))
  written.append(str(_fig_baseline_comparison(fig_dir, validation_path)))

  index = {"generated_at": _now_iso(), "figures": written}
  (fig_dir / "figures_index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
  print(str(fig_dir / "figures_index.json"))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())

