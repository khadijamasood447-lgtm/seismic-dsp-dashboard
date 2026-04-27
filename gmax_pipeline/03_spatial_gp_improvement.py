from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, RBF, WhiteKernel
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
  return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def _to_utm_xy(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  x_m, y_m = tx.transform(lon, lat)
  return np.column_stack([np.asarray(x_m, dtype=np.float64), np.asarray(y_m, dtype=np.float64)])


def _spatial_groups_utm(xy_m: np.ndarray, block_m: float) -> np.ndarray:
  gx = np.floor(np.asarray(xy_m[:, 0], dtype=np.float64) / float(block_m)).astype(int)
  gy = np.floor(np.asarray(xy_m[:, 1], dtype=np.float64) / float(block_m)).astype(int)
  return gx * 1_000_000 + gy


def _gp_model(length_scale_m: float) -> GaussianProcessRegressor:
  kernel = ConstantKernel(1.0, (1e-3, 1e3)) * RBF(length_scale=float(length_scale_m), length_scale_bounds=(200.0, 20000.0)) + WhiteKernel(
    noise_level=1.0,
    noise_level_bounds=(1e-4, 1e3),
  )
  return GaussianProcessRegressor(kernel=kernel, normalize_y=True, random_state=42)


@dataclass(frozen=True)
class Result:
  name: str
  r2_mean: float
  rmse_mean: float
  mae_mean: float
  folds: List[Dict[str, Any]]


def _cv_mean_only(y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]]) -> Result:
  rows: List[Dict[str, Any]] = []
  for i, (tr, te) in enumerate(splits, start=1):
    pred = np.full(te.shape[0], float(np.mean(y[tr])), dtype=np.float64)
    rows.append(
      {
        "fold": int(i),
        "r2": float(r2_score(y[te], pred)) if len(te) >= 3 else None,
        "rmse": _rmse(y[te], pred),
        "mae": float(mean_absolute_error(y[te], pred)),
      }
    )
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return Result(
    name="mean",
    r2_mean=float(np.mean(r2_vals)) if r2_vals else float("nan"),
    rmse_mean=float(np.mean([r["rmse"] for r in rows])),
    mae_mean=float(np.mean([r["mae"] for r in rows])),
    folds=rows,
  )


def _cv_gp_only(xy: np.ndarray, y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]], *, length_scale_m: float) -> Result:
  rows: List[Dict[str, Any]] = []
  for i, (tr, te) in enumerate(splits, start=1):
    gp = _gp_model(length_scale_m)
    gp.fit(xy[tr], y[tr])
    pred = gp.predict(xy[te]).astype(np.float64)
    rows.append(
      {
        "fold": int(i),
        "r2": float(r2_score(y[te], pred)) if len(te) >= 3 else None,
        "rmse": _rmse(y[te], pred),
        "mae": float(mean_absolute_error(y[te], pred)),
      }
    )
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return Result(
    name=f"gp_only_ls{int(length_scale_m)}",
    r2_mean=float(np.mean(r2_vals)) if r2_vals else float("nan"),
    rmse_mean=float(np.mean([r["rmse"] for r in rows])),
    mae_mean=float(np.mean([r["mae"] for r in rows])),
    folds=rows,
  )


def _cv_ridge_trend(df_feat: pd.DataFrame, y: np.ndarray, splits: List[Tuple[np.ndarray, np.ndarray]]) -> Result:
  X = df_feat.to_numpy(dtype=np.float64)
  rows: List[Dict[str, Any]] = []
  for i, (tr, te) in enumerate(splits, start=1):
    scaler = StandardScaler()
    Xt = scaler.fit_transform(X[tr])
    Xv = scaler.transform(X[te])
    m = Ridge(alpha=10.0)
    m.fit(Xt, y[tr])
    pred = m.predict(Xv).astype(np.float64)
    rows.append(
      {
        "fold": int(i),
        "r2": float(r2_score(y[te], pred)) if len(te) >= 3 else None,
        "rmse": _rmse(y[te], pred),
        "mae": float(mean_absolute_error(y[te], pred)),
      }
    )
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return Result(
    name="ridge_trend",
    r2_mean=float(np.mean(r2_vals)) if r2_vals else float("nan"),
    rmse_mean=float(np.mean([r["rmse"] for r in rows])),
    mae_mean=float(np.mean([r["mae"] for r in rows])),
    folds=rows,
  )


def _cv_ridge_plus_gp(
  df_feat: pd.DataFrame,
  xy: np.ndarray,
  y: np.ndarray,
  splits: List[Tuple[np.ndarray, np.ndarray]],
  *,
  length_scale_m: float,
) -> Result:
  X = df_feat.to_numpy(dtype=np.float64)
  rows: List[Dict[str, Any]] = []
  for i, (tr, te) in enumerate(splits, start=1):
    scaler = StandardScaler()
    Xt = scaler.fit_transform(X[tr])
    Xv = scaler.transform(X[te])
    ridge = Ridge(alpha=10.0)
    ridge.fit(Xt, y[tr])
    trend_tr = ridge.predict(Xt)
    resid_tr = (y[tr] - trend_tr).astype(np.float64)

    gp = _gp_model(length_scale_m)
    gp.fit(xy[tr], resid_tr)
    resid_pred = gp.predict(xy[te]).astype(np.float64)
    pred = (ridge.predict(Xv).astype(np.float64) + resid_pred).astype(np.float64)

    rows.append(
      {
        "fold": int(i),
        "r2": float(r2_score(y[te], pred)) if len(te) >= 3 else None,
        "rmse": _rmse(y[te], pred),
        "mae": float(mean_absolute_error(y[te], pred)),
      }
    )
  r2_vals = [r["r2"] for r in rows if r.get("r2") is not None]
  return Result(
    name=f"ridge_plus_gp_ls{int(length_scale_m)}",
    r2_mean=float(np.mean(r2_vals)) if r2_vals else float("nan"),
    rmse_mean=float(np.mean([r["rmse"] for r in rows])),
    mae_mean=float(np.mean([r["mae"] for r in rows])),
    folds=rows,
  )


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--block-m", type=float, default=2000.0)
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  metrics_dir.mkdir(parents=True, exist_ok=True)

  feat_path = preds_dir / "bender_features_27.csv"
  if not feat_path.exists():
    print("Spatial GP FAIL: missing bender_features_27.csv")
    return 2

  df = pd.read_csv(feat_path)
  df["gmax_mpa"] = pd.to_numeric(df.get("gmax_mpa"), errors="coerce")
  df = df[df["gmax_mpa"].notna()].reset_index(drop=True)
  if len(df) != 27:
    print(f"Spatial GP FAIL: expected 27 bender rows, got {len(df)}")
    return 2

  y = df["gmax_mpa"].to_numpy(dtype=np.float64)
  xy = _to_utm_xy(df["lon"].to_numpy(dtype=np.float64), df["lat"].to_numpy(dtype=np.float64))
  groups = _spatial_groups_utm(xy, float(args.block_m))
  n_splits = min(5, int(len(np.unique(groups))))
  n_splits = 3 if n_splits < 3 else n_splits

  gkf = GroupKFold(n_splits=n_splits)
  splits = list(gkf.split(xy, y, groups=groups))

  feature_cols = [c for c in df.columns if c not in ("sector", "lon", "lat", "gmax_mpa", "ll", "pl", "pi", "nearest_grid_dist_m")]
  Xdf = df[feature_cols].apply(pd.to_numeric, errors="coerce")
  for c in feature_cols:
    if Xdf[c].isna().any():
      Xdf[c] = Xdf[c].fillna(float(Xdf[c].median()))

  results: List[Result] = []
  results.append(_cv_mean_only(y, splits))
  results.append(_cv_ridge_trend(Xdf, y, splits))
  for ls in (500.0, 1000.0, 2000.0, 5000.0):
    results.append(_cv_gp_only(xy, y, splits, length_scale_m=ls))
    results.append(_cv_ridge_plus_gp(Xdf, xy, y, splits, length_scale_m=ls))

  best = sorted(results, key=lambda r: r.rmse_mean)[0]

  out = {
    "generated_at": _now_iso(),
    "block_m": float(args.block_m),
    "n_splits": int(n_splits),
    "results": [
      {"name": r.name, "r2_mean": r.r2_mean, "rmse_mean": r.rmse_mean, "mae_mean": r.mae_mean, "folds": r.folds}
      for r in results
    ],
    "best": {"name": best.name, "r2_mean": best.r2_mean, "rmse_mean": best.rmse_mean, "mae_mean": best.mae_mean},
  }
  out_path = metrics_dir / "spatial_gp_report.json"
  out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")

  print(str(out_path))
  print(json.dumps(out["best"], indent=2))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())

