from __future__ import annotations

import argparse
import json
import math
import pickle
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.dummy import DummyRegressor
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, RBF, WhiteKernel
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, LeaveOneOut
from sklearn.neighbors import KDTree
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
  return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def _mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
  y = np.asarray(y_true, dtype=np.float64)
  p = np.asarray(y_pred, dtype=np.float64)
  den = np.maximum(np.abs(y), 1e-6)
  return float(np.mean(np.abs(y - p) / den) * 100.0)


def _to_utm_xy(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  x_m, y_m = tx.transform(lon, lat)
  return np.column_stack([np.asarray(x_m, dtype=np.float64), np.asarray(y_m, dtype=np.float64)])


def _spatial_groups_utm(xy_m: np.ndarray, block_m: float) -> np.ndarray:
  gx = np.floor(np.asarray(xy_m[:, 0], dtype=np.float64) / float(block_m)).astype(int)
  gy = np.floor(np.asarray(xy_m[:, 1], dtype=np.float64) / float(block_m)).astype(int)
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


def _nearest_grid_indices(grid_lon: np.ndarray, grid_lat: np.ndarray, pts_lon: np.ndarray, pts_lat: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
  grid_xy = _to_utm_xy(grid_lon, grid_lat)
  pts_xy = _to_utm_xy(pts_lon, pts_lat)
  tree = KDTree(grid_xy)
  dist, ind = tree.query(pts_xy, k=1)
  return ind.ravel(), dist.ravel()


def _make_vs30_proxy(
  *,
  grid_raw: pd.DataFrame,
  vs30: pd.DataFrame,
  v_ind: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
  bd = pd.to_numeric(grid_raw.iloc[v_ind].get("bulk_density"), errors="coerce").to_numpy(dtype=np.float64)
  bd_g_cm3 = np.array([_infer_bulk_density_g_cm3(float(x)) for x in bd], dtype=np.float64)
  vs = vs30["vs30_m_s"].to_numpy(dtype=np.float64)
  g_proxy_raw = (bd_g_cm3 * (vs * vs)) / 1000.0
  g_proxy_raw = np.where(np.isfinite(g_proxy_raw), g_proxy_raw, np.nan)
  g_proxy_raw = np.clip(g_proxy_raw, 1.0, 500.0)
  return g_proxy_raw, np.zeros(g_proxy_raw.shape[0], dtype=np.float64)


def _ensemble_predict_log(models: List[Any], X: np.ndarray) -> np.ndarray:
  preds = np.stack([m.predict(X).astype(np.float64) for m in models], axis=0)
  return np.mean(preds, axis=0).astype(np.float64)


def _gp_model(length_scale_m: float) -> GaussianProcessRegressor:
  kernel = ConstantKernel(1.0, (1e-3, 1e3)) * RBF(length_scale=float(length_scale_m), length_scale_bounds=(200.0, 20000.0)) + WhiteKernel(
    noise_level=1.0,
    noise_level_bounds=(1e-4, 1e3),
  )
  return GaussianProcessRegressor(kernel=kernel, normalize_y=True, random_state=42)


def _cv_splits_spatial(xy: np.ndarray, *, block_m: float, n_splits_target: int) -> Tuple[List[Tuple[np.ndarray, np.ndarray]], Dict[str, Any]]:
  groups = _spatial_groups_utm(xy, block_m=float(block_m))
  n_groups = int(len(np.unique(groups)))
  n_splits = int(min(max(2, n_splits_target), n_groups))
  gkf = GroupKFold(n_splits=n_splits)
  splits = list(gkf.split(xy, np.zeros(xy.shape[0]), groups=groups))
  meta = {"method": "GroupKFold", "block_m": float(block_m), "n_splits": int(n_splits), "n_groups": n_groups}
  return splits, meta


def _cv_splits_loocv(n: int) -> Tuple[List[Tuple[np.ndarray, np.ndarray]], Dict[str, Any]]:
  loo = LeaveOneOut()
  splits = [(tr, te) for tr, te in loo.split(np.zeros((n, 1)))]
  return splits, {"method": "LeaveOneOut", "n_splits": int(n)}


def _eval_predictions(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, Any]:
  return {
    "r2": float(r2_score(y_true, y_pred)) if len(y_true) >= 3 else None,
    "rmse": _rmse(y_true, y_pred),
    "mae": float(mean_absolute_error(y_true, y_pred)),
    "mape_pct": _mape(y_true, y_pred),
  }


def _cv_mean(y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]]) -> Dict[str, Any]:
  rows = []
  for i, (tr, te) in enumerate(splits, start=1):
    pred = np.full(te.shape[0], float(np.mean(y[tr])), dtype=np.float64)
    m = _eval_predictions(y[te], pred)
    rows.append({"fold": int(i), "n_train": int(len(tr)), "n_test": int(len(te)), **m})
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return {
    "folds": rows,
    "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
    "rmse_mean": float(np.mean([r["rmse"] for r in rows])),
    "mae_mean": float(np.mean([r["mae"] for r in rows])),
    "mape_mean_pct": float(np.mean([r["mape_pct"] for r in rows])),
  }


def _cv_gp(xy: np.ndarray, y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]], *, length_scale_m: float) -> Dict[str, Any]:
  rows = []
  for i, (tr, te) in enumerate(splits, start=1):
    gp = _gp_model(length_scale_m)
    gp.fit(xy[tr], y[tr])
    pred = gp.predict(xy[te]).astype(np.float64)
    m = _eval_predictions(y[te], pred)
    rows.append({"fold": int(i), "n_train": int(len(tr)), "n_test": int(len(te)), **m})
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return {
    "params": {"length_scale_m": float(length_scale_m)},
    "folds": rows,
    "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
    "rmse_mean": float(np.mean([r["rmse"] for r in rows])),
    "mae_mean": float(np.mean([r["mae"] for r in rows])),
    "mape_mean_pct": float(np.mean([r["mape_pct"] for r in rows])),
  }


def _cv_linear(X: np.ndarray, y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]], *, ridge_alpha: float | None) -> Dict[str, Any]:
  rows = []
  for i, (tr, te) in enumerate(splits, start=1):
    scaler = StandardScaler()
    Xt = scaler.fit_transform(X[tr])
    Xv = scaler.transform(X[te])
    if ridge_alpha is None:
      m0 = LinearRegression()
    else:
      m0 = Ridge(alpha=float(ridge_alpha))
    m0.fit(Xt, y[tr])
    pred = m0.predict(Xv).astype(np.float64)
    m = _eval_predictions(y[te], pred)
    rows.append({"fold": int(i), "n_train": int(len(tr)), "n_test": int(len(te)), **m})
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return {
    "params": {"ridge_alpha": None if ridge_alpha is None else float(ridge_alpha)},
    "folds": rows,
    "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
    "rmse_mean": float(np.mean([r["rmse"] for r in rows])),
    "mae_mean": float(np.mean([r["mae"] for r in rows])),
    "mape_mean_pct": float(np.mean([r["mape_pct"] for r in rows])),
  }


def _cv_xgb_single(X: np.ndarray, y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]]) -> Dict[str, Any]:
  rows = []
  for i, (tr, te) in enumerate(splits, start=1):
    m0 = XGBRegressor(
      n_estimators=300,
      max_depth=4,
      learning_rate=0.04,
      subsample=0.8,
      colsample_bytree=0.8,
      reg_lambda=20.0,
      reg_alpha=5.0,
      min_child_weight=8.0,
      objective="reg:squarederror",
      random_state=42,
      n_jobs=1,
    )
    m0.fit(X[tr], np.log1p(y[tr]))
    pred = np.expm1(m0.predict(X[te]).astype(np.float64))
    m = _eval_predictions(y[te], pred)
    rows.append({"fold": int(i), "n_train": int(len(tr)), "n_test": int(len(te)), **m})
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return {
    "folds": rows,
    "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
    "rmse_mean": float(np.mean([r["rmse"] for r in rows])),
    "mae_mean": float(np.mean([r["mae"] for r in rows])),
    "mape_mean_pct": float(np.mean([r["mape_pct"] for r in rows])),
  }


def _cv_vs30weak_ensemble(
  X_b: np.ndarray,
  y_b: np.ndarray,
  X_v: np.ndarray,
  y_v: np.ndarray,
  splits: List[Tuple[np.ndarray, np.ndarray]],
  *,
  w_b: float,
  w_v: float,
  feature_cols: List[str],
) -> Dict[str, Any]:
  rows = []
  for i, (tr, te) in enumerate(splits, start=1):
    Xt = np.concatenate([X_b[tr], X_v], axis=0)
    yt = np.concatenate([np.log1p(y_b[tr]), np.log1p(y_v)], axis=0)
    wt = np.concatenate([np.full(len(tr), float(w_b)), np.full(len(X_v), float(w_v))], axis=0)

    preds = []
    for seed in (42, 123, 456, 789, 101112):
      m0 = XGBRegressor(
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
      )
      m0.fit(Xt, yt, sample_weight=wt)
      preds.append(m0.predict(X_b[te]).astype(np.float64))

    pred = np.expm1(np.mean(np.stack(preds, axis=0), axis=0))
    m = _eval_predictions(y_b[te], pred)
    rows.append({"fold": int(i), "n_train": int(len(tr)), "n_test": int(len(te)), "n_vs30": int(len(X_v)), **m})

  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return {
    "weights": {"bender": float(w_b), "vs30": float(w_v)},
    "folds": rows,
    "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
    "rmse_mean": float(np.mean([r["rmse"] for r in rows])),
    "mae_mean": float(np.mean([r["mae"] for r in rows])),
    "mape_mean_pct": float(np.mean([r["mape_pct"] for r in rows])),
  }


def _plot_validation(out_path: Path, y_true: np.ndarray, y_pred: np.ndarray, resid: np.ndarray, xy: np.ndarray) -> None:
  fig = plt.figure(figsize=(12, 9), dpi=160)
  gs = fig.add_gridspec(2, 2)

  ax1 = fig.add_subplot(gs[0, 0])
  ax1.scatter(y_true, y_pred, s=35)
  lo = float(min(np.min(y_true), np.min(y_pred)))
  hi = float(max(np.max(y_true), np.max(y_pred)))
  ax1.plot([lo, hi], [lo, hi])
  ax1.set_title("Predicted vs Actual (Bender)")
  ax1.set_xlabel("Actual Gmax (MPa)")
  ax1.set_ylabel("Predicted Gmax (MPa)")

  ax2 = fig.add_subplot(gs[0, 1])
  ax2.hist(resid, bins=12)
  ax2.set_title("Residual Histogram")
  ax2.set_xlabel("Residual (MPa)")
  ax2.set_ylabel("Count")

  ax3 = fig.add_subplot(gs[1, 0])
  ax3.scatter(y_pred, resid, s=35)
  ax3.axhline(0.0)
  ax3.set_title("Residuals vs Predicted")
  ax3.set_xlabel("Predicted Gmax (MPa)")
  ax3.set_ylabel("Residual (MPa)")

  ax4 = fig.add_subplot(gs[1, 1])
  sc = ax4.scatter(xy[:, 0], xy[:, 1], c=np.abs(resid), s=55)
  fig.colorbar(sc, ax=ax4, label="|Residual| (MPa)")
  ax4.set_title("Spatial Absolute Error (UTM)")
  ax4.set_xlabel("Easting (m)")
  ax4.set_ylabel("Northing (m)")

  out_path.parent.mkdir(parents=True, exist_ok=True)
  fig.tight_layout()
  fig.savefig(out_path)
  plt.close(fig)


def _plot_pred_vs_actual(out_path: Path, y_true: np.ndarray, y_pred: np.ndarray, *, title: str) -> None:
  fig = plt.figure(figsize=(6.8, 5.8), dpi=180)
  ax = fig.add_subplot(1, 1, 1)
  ax.scatter(y_true, y_pred, s=35)
  lo = float(min(np.min(y_true), np.min(y_pred)))
  hi = float(max(np.max(y_true), np.max(y_pred)))
  ax.plot([lo, hi], [lo, hi])
  ax.set_title(title)
  ax.set_xlabel('Actual (MPa)')
  ax.set_ylabel('Predicted (MPa)')
  out_path.parent.mkdir(parents=True, exist_ok=True)
  fig.tight_layout()
  fig.savefig(out_path)
  plt.close(fig)


def _sanitize_json(x: Any) -> Any:
  if isinstance(x, float):
    return x if math.isfinite(x) else None
  if isinstance(x, (int, str, bool)) or x is None:
    return x
  if isinstance(x, list):
    return [_sanitize_json(v) for v in x]
  if isinstance(x, dict):
    return {k: _sanitize_json(v) for k, v in x.items()}
  return str(x)


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--vs30-xlsx", default=str(REPO_ROOT / "ISLAMABD DATA" / "Table3_VS30.xlsx"))
  ap.add_argument("--max-vs30-dist-m", type=float, default=300.0)
  ap.add_argument("--w-bender", type=float, default=10.0)
  ap.add_argument("--w-vs30", type=float, default=0.5)
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  models_dir = outputs_dir / "models"
  metrics_dir.mkdir(parents=True, exist_ok=True)

  feat_path = preds_dir / "bender_features_27.csv"
  grid_raw_path = preds_dir / "aoi_grid_complete.csv"
  feat_norm_path = preds_dir / "aoi_features_normalized.csv"
  model_path = models_dir / "model_ensemble_5_vs30weak.pkl"
  if not (feat_path.exists() and grid_raw_path.exists() and feat_norm_path.exists() and model_path.exists()):
    print("Phase 5 FAIL: missing required Phase 2/3 artifacts")
    return 2

  bender = pd.read_csv(feat_path)
  bender["gmax_mpa"] = pd.to_numeric(bender.get("gmax_mpa"), errors="coerce")
  bender = bender[bender["gmax_mpa"].notna()].reset_index(drop=True)
  if len(bender) != 27:
    print(f"Phase 5 FAIL: expected 27 bender rows, got {len(bender)}")
    return 2

  feature_cols = [c for c in bender.columns if c not in ("sector", "lon", "lat", "gmax_mpa", "ll", "pl", "pi", "nearest_grid_dist_m")]
  X_b = bender[feature_cols].apply(pd.to_numeric, errors="coerce")
  for c in feature_cols:
    if X_b[c].isna().any():
      X_b[c] = X_b[c].fillna(float(X_b[c].median()))
  X_b_np = X_b.to_numpy(dtype=np.float64)
  y_b = bender["gmax_mpa"].to_numpy(dtype=np.float64)
  xy = _to_utm_xy(bender["lon"].to_numpy(dtype=np.float64), bender["lat"].to_numpy(dtype=np.float64))

  grid_raw = pd.read_csv(grid_raw_path)
  features_norm = pd.read_csv(feat_norm_path)
  vs30 = _parse_vs30_table(Path(args.vs30_xlsx))
  v_ind_all, v_dist_all = _nearest_grid_indices(
    features_norm["lon"].to_numpy(dtype=float),
    features_norm["lat"].to_numpy(dtype=float),
    vs30["lon"].to_numpy(dtype=float),
    vs30["lat"].to_numpy(dtype=float),
  )
  keep = v_dist_all <= float(args.max_vs30_dist_m)
  v_ind = v_ind_all[keep]
  v_dist = v_dist_all[keep]
  vs30 = vs30.loc[keep].reset_index(drop=True)
  if len(vs30) == 0:
    print("Phase 5 FAIL: no VS30 points mapped to AOI grid")
    return 2

  g_proxy_raw, _ = _make_vs30_proxy(grid_raw=grid_raw, vs30=vs30, v_ind=v_ind)

  med_local = float(np.median(y_b))
  med_proxy = float(np.nanmedian(g_proxy_raw))
  scale = (med_local / med_proxy) if med_proxy > 0 else 1.0
  y_v = np.clip(g_proxy_raw * float(scale), 1.0, 500.0)

  X_v = features_norm.iloc[v_ind][feature_cols].apply(pd.to_numeric, errors="coerce")
  for c in feature_cols:
    if X_v[c].isna().any():
      X_v[c] = X_v[c].fillna(float(X_v[c].median()))
  X_v_np = X_v.to_numpy(dtype=np.float64)

  splits_strict, strict_meta = _cv_splits_spatial(xy, block_m=2000.0, n_splits_target=5)
  splits_practical, practical_meta = _cv_splits_spatial(xy, block_m=1000.0, n_splits_target=3)
  splits_loocv, loocv_meta = _cv_splits_loocv(len(y_b))

  baselines = {
    "mean": {
      "strict": _cv_mean(y_b, splits_strict),
      "practical": _cv_mean(y_b, splits_practical),
      "loocv": _cv_mean(y_b, splits_loocv),
    },
    "gp_only": {
      "strict": _cv_gp(xy, y_b, splits_strict, length_scale_m=2000.0),
      "practical": _cv_gp(xy, y_b, splits_practical, length_scale_m=1000.0),
    },
    "linear": {
      "strict": _cv_linear(X_b_np, y_b, splits_strict, ridge_alpha=None),
      "practical": _cv_linear(X_b_np, y_b, splits_practical, ridge_alpha=None),
    },
    "ridge": {
      "strict": _cv_linear(X_b_np, y_b, splits_strict, ridge_alpha=10.0),
      "practical": _cv_linear(X_b_np, y_b, splits_practical, ridge_alpha=10.0),
    },
    "xgb_single": {
      "strict": _cv_xgb_single(X_b_np, y_b, splits_strict),
      "practical": _cv_xgb_single(X_b_np, y_b, splits_practical),
    },
    "vs30weak_ensemble": {
      "strict": _cv_vs30weak_ensemble(X_b_np, y_b, X_v_np, y_v, splits_strict, w_b=float(args.w_bender), w_v=float(args.w_vs30), feature_cols=feature_cols),
      "practical": _cv_vs30weak_ensemble(X_b_np, y_b, X_v_np, y_v, splits_practical, w_b=float(args.w_bender), w_v=float(args.w_vs30), feature_cols=feature_cols),
    },
  }

  best_practical = min(
    [(k, v["practical"]["rmse_mean"]) for k, v in baselines.items() if "practical" in v],
    key=lambda t: float(t[1]),
  )

  model_obj = pickle.load(model_path.open("rb"))
  models = model_obj["models"]
  feat_cols_model = list(model_obj["feature_cols"])
  X_for_model = bender[feat_cols_model].apply(pd.to_numeric, errors="coerce")
  for c in feat_cols_model:
    if X_for_model[c].isna().any():
      X_for_model[c] = X_for_model[c].fillna(float(X_for_model[c].median()))
  pred_log = _ensemble_predict_log(models, X_for_model.to_numpy(dtype=np.float32))
  pred = np.expm1(pred_log)
  resid = (y_b - pred).astype(np.float64)

  plot_path = metrics_dir / "validation_plots.png"
  _plot_validation(plot_path, y_b, pred, resid, xy)

  layer_path = preds_dir / "aoi_predictions_final.csv"
  layer_plot_path = metrics_dir / "pred_vs_actual_islamabad_layer.png"
  layer_vs30_plot_path = metrics_dir / "pred_vs_vs30proxy_islamabad_layer.png"
  layer_metrics: Dict[str, Any] | None = None
  layer_vs30_metrics: Dict[str, Any] | None = None
  bender_layer_csv: str | None = None
  if layer_path.exists():
    layer = pd.read_csv(layer_path)
    if {"lon", "lat", "gmax_mpa_predicted"}.issubset(set(layer.columns)):
      layer_xy = _to_utm_xy(layer["lon"].to_numpy(dtype=np.float64), layer["lat"].to_numpy(dtype=np.float64))
      tree = KDTree(layer_xy)
      dist_m, ind = tree.query(xy, k=1)
      ind = ind.ravel()
      pred_layer = pd.to_numeric(layer.iloc[ind]["gmax_mpa_predicted"], errors="coerce").to_numpy(dtype=np.float64)
      mask = np.isfinite(pred_layer) & np.isfinite(y_b)
      pred_layer = pred_layer[mask]
      y_layer_true = y_b[mask]
      _plot_pred_vs_actual(layer_plot_path, y_layer_true, pred_layer, title='Islamabad Layer: Predicted vs Actual (Bender)')
      layer_metrics = {"n": int(len(y_layer_true)), "nearest_dist_m_max": float(np.max(dist_m)) if len(dist_m) else None, **_eval_predictions(y_layer_true, pred_layer)}

      out_bender_layer = pd.DataFrame({"lon": bender.loc[mask, "lon"], "lat": bender.loc[mask, "lat"], "gmax_actual_mpa": y_layer_true, "gmax_pred_layer_mpa": pred_layer})
      bender_layer_path = metrics_dir / "bender_pred_vs_actual_layer.csv"
      out_bender_layer.to_csv(bender_layer_path, index=False)
      bender_layer_csv = str(bender_layer_path)

      if len(y_v) > 0:
        vs_xy = _to_utm_xy(vs30.loc[: len(v_ind) - 1, "lon"].to_numpy(dtype=np.float64), vs30.loc[: len(v_ind) - 1, "lat"].to_numpy(dtype=np.float64))
        dist2, ind2 = tree.query(vs_xy, k=1)
        pred_layer_vs = pd.to_numeric(layer.iloc[ind2.ravel()]["gmax_mpa_predicted"], errors="coerce").to_numpy(dtype=np.float64)
        mask2 = np.isfinite(pred_layer_vs) & np.isfinite(y_v)
        _plot_pred_vs_actual(layer_vs30_plot_path, y_v[mask2], pred_layer_vs[mask2], title='Islamabad Layer: Predicted vs Vs30-Proxy')
        layer_vs30_metrics = {"n": int(np.sum(mask2)), "nearest_dist_m_max": float(np.max(dist2)) if len(dist2) else None, **_eval_predictions(y_v[mask2], pred_layer_vs[mask2])}

  report = {
    "phase": 5,
    "generated_at": _now_iso(),
    "inputs": {
      "bender_features": str(feat_path),
      "aoi_grid_raw": str(grid_raw_path),
      "aoi_features": str(feat_norm_path),
      "model": str(model_path),
      "vs30_xlsx": str(Path(args.vs30_xlsx).resolve()),
    },
    "data": {
      "bender_n": int(len(y_b)),
      "vs30_proxy_n": int(len(y_v)),
      "vs30_proxy_scale": {"median_local": med_local, "median_proxy_raw": med_proxy, "scale": float(scale)},
      "vs30_nearest_grid_dist_m_max": float(np.max(v_dist)) if len(v_dist) else None,
    },
    "cv_schemes": {"strict": strict_meta, "practical": practical_meta, "loocv": loocv_meta},
    "comparisons": baselines,
    "best_practical": {"name": best_practical[0], "rmse_mean": float(best_practical[1])},
    "in_sample": {"r2": float(r2_score(y_b, pred)), "rmse": _rmse(y_b, pred), "mae": float(mean_absolute_error(y_b, pred)), "mape_pct": _mape(y_b, pred)},
    "islamabad_layer": {"bender": layer_metrics, "vs30_proxy": layer_vs30_metrics},
    "outputs": {"validation_report": str(metrics_dir / "validation_report.json"), "plots": str(plot_path)},
  }
  out_path = metrics_dir / "validation_report.json"
  out_path.write_text(json.dumps(_sanitize_json(report), indent=2), encoding="utf-8")

  print("Phase 5 PASS")
  print(str(out_path))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
