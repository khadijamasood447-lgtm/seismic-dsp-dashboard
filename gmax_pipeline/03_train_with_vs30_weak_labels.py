from __future__ import annotations

import argparse
import json
import math
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import shape, Point
from sklearn.dummy import DummyRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.neighbors import KDTree
from xgboost import XGBRegressor


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
  return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def _spatial_groups_utm(lon: np.ndarray, lat: np.ndarray, block_m: float) -> np.ndarray:
  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  x_m, y_m = tx.transform(lon, lat)
  gx = np.floor(np.asarray(x_m, dtype=np.float64) / float(block_m)).astype(int)
  gy = np.floor(np.asarray(y_m, dtype=np.float64) / float(block_m)).astype(int)
  return gx * 1_000_000 + gy


def _infer_bulk_density_g_cm3(v: float) -> float:
  if not math.isfinite(v):
    return float("nan")
  if v > 20.0:
    return float(v) * 0.01
  return float(v)


def _parse_vs30_table(xlsx_path: Path) -> pd.DataFrame:
  raw = pd.read_excel(xlsx_path, header=None)
  header_row = None
  for i in range(min(50, len(raw))):
    row = raw.iloc[i].astype(str).str.lower().tolist()
    if any("longitude" in c for c in row) and any("latitude" in c for c in row) and any("vs30" in c for c in row):
      header_row = i
      break
  if header_row is None:
    raise RuntimeError("Could not locate VS30 header row in Table3_VS30.xlsx")

  df = pd.read_excel(xlsx_path, header=header_row)
  cols = {c.lower().strip(): c for c in df.columns}

  lon_col = None
  lat_col = None
  vs_col = None
  for k, c in cols.items():
    if "longitude" in k:
      lon_col = c
    if "latitude" in k:
      lat_col = c
    if "vs30" in k:
      vs_col = c
  if lon_col is None or lat_col is None or vs_col is None:
    raise RuntimeError("VS30 table is missing Longitude/Latitude/VS30 columns")

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


def _load_aoi_polygon(aoi_geojson: Path) -> Any:
  obj = json.loads(aoi_geojson.read_text(encoding="utf-8"))
  geom = obj["features"][0]["geometry"]
  return shape(geom)


def _nearest_grid_indices(grid_lon: np.ndarray, grid_lat: np.ndarray, pts_lon: np.ndarray, pts_lat: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  gx, gy = tx.transform(grid_lon, grid_lat)
  px, py = tx.transform(pts_lon, pts_lat)
  tree = KDTree(np.column_stack([gx, gy]))
  dist, ind = tree.query(np.column_stack([px, py]), k=1)
  return ind.ravel(), dist.ravel()


def _monotone_constraints(feature_cols: List[str]) -> str:
  cons: List[int] = []
  for c in feature_cols:
    if c == "bulk_density":
      cons.append(1)
    elif c == "water_content":
      cons.append(-1)
    elif c == "clay_pct":
      cons.append(-1)
    else:
      cons.append(0)
  return "(" + ",".join(str(v) for v in cons) + ")"


def _train_model(seed: int, monotone: str) -> XGBRegressor:
  return XGBRegressor(
    n_estimators=300,
    max_depth=4,
    learning_rate=0.04,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_lambda=20.0,
    reg_alpha=5.0,
    min_child_weight=8.0,
    objective="reg:squarederror",
    random_state=int(seed),
    n_jobs=1,
    monotone_constraints=monotone,
  )


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--vs30-xlsx", default=str(REPO_ROOT / "ISLAMABD DATA" / "Table3_VS30.xlsx"))
  ap.add_argument("--block-m", type=float, default=2000.0)
  ap.add_argument("--weight-bender", type=float, default=10.0)
  ap.add_argument("--weight-vs30", type=float, default=0.5)
  ap.add_argument("--max-vs30_dist_m", type=float, default=300.0)
  ap.add_argument("--target", default="gmax")
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  models_dir = outputs_dir / "models"
  preds_dir.mkdir(parents=True, exist_ok=True)
  metrics_dir.mkdir(parents=True, exist_ok=True)
  models_dir.mkdir(parents=True, exist_ok=True)

  grid_raw_path = preds_dir / "aoi_grid_complete.csv"
  features_path = preds_dir / "aoi_features_normalized.csv"
  bender_path = preds_dir / "islamabad_targets_clean.csv"
  aoi_path = preds_dir / "aoi_polygon.geojson"
  if not (grid_raw_path.exists() and features_path.exists() and bender_path.exists()):
    print("Weak-supervision FAIL: missing Phase 1/2 outputs")
    return 2
  if not aoi_path.exists():
    print("Weak-supervision FAIL: missing AOI polygon")
    return 2

  grid_raw = pd.read_csv(grid_raw_path)
  features = pd.read_csv(features_path)
  bender = pd.read_csv(bender_path)
  bender["gmax_mpa"] = pd.to_numeric(bender.get("gmax_mpa"), errors="coerce")
  bender = bender[bender["gmax_mpa"].notna()].reset_index(drop=True)
  if len(bender) != 27:
    print(f"Weak-supervision FAIL: expected 27 bender rows, got {len(bender)}")
    return 2

  vs30 = _parse_vs30_table(Path(args.vs30_xlsx))
  aoi = _load_aoi_polygon(aoi_path)
  inside = []
  for r in vs30.itertuples(index=False):
    p = Point(float(r.lon), float(r.lat))
    inside.append(bool(aoi.contains(p) or aoi.touches(p)))
  vs30 = vs30.loc[np.asarray(inside, dtype=bool)].reset_index(drop=True)
  if len(vs30) < 10:
    print(f"Weak-supervision FAIL: too few VS30 rows inside AOI ({len(vs30)})")
    return 2

  b_ind, b_dist = _nearest_grid_indices(
    features["lon"].to_numpy(dtype=float),
    features["lat"].to_numpy(dtype=float),
    bender["lon"].to_numpy(dtype=float),
    bender["lat"].to_numpy(dtype=float),
  )
  v_ind, v_dist = _nearest_grid_indices(
    features["lon"].to_numpy(dtype=float),
    features["lat"].to_numpy(dtype=float),
    vs30["lon"].to_numpy(dtype=float),
    vs30["lat"].to_numpy(dtype=float),
  )

  feature_cols = [c for c in features.columns if c not in ("grid_id", "lon", "lat")]
  X_b = features.iloc[b_ind][feature_cols].to_numpy(dtype=np.float32)
  X_v = features.iloc[v_ind][feature_cols].to_numpy(dtype=np.float32)

  keep_vs = v_dist <= float(args.max_vs30_dist_m)
  v_ind = v_ind[keep_vs]
  v_dist = v_dist[keep_vs]
  vs30 = vs30.loc[keep_vs].reset_index(drop=True)
  X_v = X_v[keep_vs]
  if len(vs30) < 10:
    print(f"Weak-supervision FAIL: too few VS30 rows near AOI grid (<= {args.max_vs30_dist_m:.0f} m)")
    return 2

  bd = pd.to_numeric(grid_raw.iloc[v_ind].get("bulk_density"), errors="coerce").to_numpy(dtype=np.float64)
  bd_g_cm3 = np.array([_infer_bulk_density_g_cm3(float(x)) for x in bd], dtype=np.float64)
  vs = vs30["vs30_m_s"].to_numpy(dtype=np.float64)
  g_proxy_raw = (bd_g_cm3 * (vs * vs)) / 1000.0
  g_proxy_raw = np.where(np.isfinite(g_proxy_raw), g_proxy_raw, np.nan)
  g_proxy_raw = np.clip(g_proxy_raw, 1.0, 500.0)

  y_b = bender["gmax_mpa"].to_numpy(dtype=np.float64)

  med_local = float(np.median(y_b))
  med_proxy = float(np.nanmedian(g_proxy_raw))
  scale = (med_local / med_proxy) if med_proxy > 0 else 1.0
  g_proxy = np.clip(g_proxy_raw * float(scale), 1.0, 500.0)
  y_v = g_proxy

  y_b_log = np.log1p(y_b)
  y_v_log = np.log1p(y_v)

  X_train_all = np.concatenate([X_b, X_v], axis=0)
  y_train_all = np.concatenate([y_b_log, y_v_log], axis=0)
  w_all = np.concatenate(
    [np.full(len(X_b), float(args.weight_bender), dtype=np.float64), np.full(len(X_v), float(args.weight_vs30), dtype=np.float64)],
    axis=0,
  )

  seeds = [42, 123, 456, 789, 101112]
  monotone = _monotone_constraints(feature_cols)

  def run_cv(block_m: float, n_splits_target: int) -> Dict[str, Any]:
    groups = _spatial_groups_utm(
      bender["lon"].to_numpy(dtype=float),
      bender["lat"].to_numpy(dtype=float),
      float(block_m),
    )
    n_groups = int(len(np.unique(groups)))
    n_splits = int(min(max(2, n_splits_target), n_groups))
    gkf = GroupKFold(n_splits=n_splits)

    cv_rows: List[Dict[str, Any]] = []
    for fold, (tr, te) in enumerate(gkf.split(X_b, y_b_log, groups=groups), start=1):
      Xt = np.concatenate([X_b[tr], X_v], axis=0)
      yt = np.concatenate([y_b_log[tr], y_v_log], axis=0)
      wt = np.concatenate(
        [np.full(len(tr), float(args.weight_bender), dtype=np.float64), np.full(len(X_v), float(args.weight_vs30), dtype=np.float64)],
        axis=0,
      )

      preds: List[np.ndarray] = []
      for seed in seeds:
        m = _train_model(seed, monotone)
        m.fit(Xt, yt, sample_weight=wt)
        preds.append(m.predict(X_b[te]))
      pred_log = np.mean(np.stack(preds, axis=0), axis=0)

      y_true = np.expm1(y_b_log[te])
      y_pred = np.expm1(pred_log)

      baseline = DummyRegressor(strategy="mean")
      baseline.fit(X_b[tr], y_b_log[tr])
      base_pred = np.expm1(baseline.predict(X_b[te]))

      cv_rows.append(
        {
          "fold": int(fold),
          "n_train_bender": int(len(tr)),
          "n_test_bender": int(len(te)),
          "n_vs30": int(len(X_v)),
          "r2": float(r2_score(y_true, y_pred)) if len(te) >= 3 else None,
          "rmse": _rmse(y_true, y_pred),
          "mae": float(mean_absolute_error(y_true, y_pred)),
          "baseline_rmse": _rmse(y_true, base_pred),
        }
      )

    r2_vals = [r["r2"] for r in cv_rows if r.get("r2") is not None]
    rmse_mean = float(np.mean([r["rmse"] for r in cv_rows]))
    base_rmse_mean = float(np.mean([r["baseline_rmse"] for r in cv_rows]))
    r2_mean = float(np.mean(r2_vals)) if r2_vals else float("nan")
    improvement = (base_rmse_mean - rmse_mean) / base_rmse_mean if base_rmse_mean > 0 else 0.0
    return {
      "method": "GroupKFold",
      "block_m": float(block_m),
      "n_splits": int(n_splits),
      "folds": cv_rows,
      "r2_mean": r2_mean,
      "rmse_mean": rmse_mean,
      "baseline_rmse_mean": base_rmse_mean,
      "rmse_improvement_frac": float(improvement),
    }

  cv_strict = run_cv(block_m=2000.0, n_splits_target=5)
  cv_practical = run_cv(block_m=1000.0, n_splits_target=3)

  ens: List[XGBRegressor] = []
  for seed in seeds:
    m = _train_model(seed, monotone)
    m.fit(X_train_all, y_train_all, sample_weight=w_all)
    ens.append(m)

  model_path = models_dir / "model_ensemble_5_vs30weak.pkl"
  with model_path.open("wb") as f:
    pickle.dump(
      {
        "models": ens,
        "feature_cols": feature_cols,
        "target": "log1p(gmax_mpa)",
        "weights": {"bender": float(args.weight_bender), "vs30": float(args.weight_vs30)},
        "vs30_proxy": "bulk_density_g_cm3 * Vs30^2 / 1000",
      },
      f,
    )

  report = {
    "generated_at": _now_iso(),
    "ok": bool(np.isfinite(float(cv_strict["r2_mean"])) and float(cv_strict["r2_mean"]) > -0.5),
    "inputs": {
      "bender": str(bender_path),
      "vs30": str(Path(args.vs30_xlsx).resolve()),
      "grid_raw": str(grid_raw_path),
      "features": str(features_path),
    },
    "data": {
      "bender_n": int(len(X_b)),
      "vs30_n": int(len(X_v)),
      "vs30_nearest_grid_dist_m_max": float(np.max(v_dist)),
      "bender_nearest_grid_dist_m_max": float(np.max(b_dist)),
      "vs30_proxy_scaling": {"median_local": med_local, "median_proxy_raw": med_proxy, "scale": float(scale)},
      "weights": {"bender": float(args.weight_bender), "vs30": float(args.weight_vs30)},
    },
    "cv": {"strict": cv_strict, "practical": cv_practical},
    "outputs": {"model": str(model_path)},
  }
  out_report = models_dir / "training_report_vs30weak.json"
  out_report.write_text(json.dumps(report, indent=2), encoding="utf-8")

  print(str(out_report))
  print(
    json.dumps(
      {
        "strict": {
          "r2_mean": float(cv_strict["r2_mean"]),
          "rmse_mean": float(cv_strict["rmse_mean"]),
          "baseline_rmse_mean": float(cv_strict["baseline_rmse_mean"]),
          "improvement": float(cv_strict["rmse_improvement_frac"]),
        },
        "practical": {
          "r2_mean": float(cv_practical["r2_mean"]),
          "rmse_mean": float(cv_practical["rmse_mean"]),
          "baseline_rmse_mean": float(cv_practical["baseline_rmse_mean"]),
          "improvement": float(cv_practical["rmse_improvement_frac"]),
        },
      },
      indent=2,
    )
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
