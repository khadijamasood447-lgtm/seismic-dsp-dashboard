from __future__ import annotations

import argparse
import json
import pickle
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.dummy import DummyRegressor
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
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


def _monotone_for_cols(cols: List[str]) -> str:
  cons: List[int] = []
  for c in cols:
    if c == "bulk_density":
      cons.append(1)
    elif c == "water_content":
      cons.append(-1)
    elif c == "clay_pct":
      cons.append(-1)
    else:
      cons.append(0)
  return "(" + ",".join(str(v) for v in cons) + ")"


@dataclass(frozen=True)
class Candidate:
  name: str
  kind: str
  params: Dict[str, Any]


def _candidates() -> List[Candidate]:
  return [
    Candidate("dummy_mean", "dummy", {}),
    Candidate("ridge_a1", "ridge", {"alpha": 1.0}),
    Candidate("ridge_a10", "ridge", {"alpha": 10.0}),
    Candidate("ridge_a100", "ridge", {"alpha": 100.0}),
    Candidate("enet_a1_l05", "enet", {"alpha": 1.0, "l1_ratio": 0.5}),
    Candidate("enet_a10_l05", "enet", {"alpha": 10.0, "l1_ratio": 0.5}),
    Candidate(
      "xgb_small",
      "xgb",
      {
        "n_estimators": 250,
        "max_depth": 3,
        "learning_rate": 0.04,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_lambda": 20.0,
        "reg_alpha": 5.0,
        "min_child_weight": 8.0,
      },
    ),
  ]


def _fit_predict(candidate: Candidate, X_tr: np.ndarray, y_tr: np.ndarray, X_te: np.ndarray, feature_cols: List[str]) -> np.ndarray:
  if candidate.kind == "dummy":
    m = DummyRegressor(strategy="mean")
    m.fit(X_tr, y_tr)
    return m.predict(X_te)

  if candidate.kind == "ridge":
    m = Ridge(alpha=float(candidate.params["alpha"]))
    m.fit(X_tr, y_tr)
    return m.predict(X_te)

  if candidate.kind == "enet":
    m = ElasticNet(alpha=float(candidate.params["alpha"]), l1_ratio=float(candidate.params["l1_ratio"]), max_iter=5000)
    m.fit(X_tr, y_tr)
    return m.predict(X_te)

  if candidate.kind == "xgb":
    mono = _monotone_for_cols(feature_cols)
    m = XGBRegressor(
      objective="reg:squarederror",
      random_state=42,
      n_jobs=1,
      monotone_constraints=mono,
      **candidate.params,
    )
    m.fit(X_tr, y_tr)
    return m.predict(X_te)

  raise RuntimeError(f"Unknown candidate kind: {candidate.kind}")


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--block-m", type=float, default=2000.0)
  ap.add_argument("--n-splits", type=int, default=3)
  args = ap.parse_args(list(argv) if argv is not None else None)

  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"
  models_dir = outputs_dir / "models"
  metrics_dir.mkdir(parents=True, exist_ok=True)
  models_dir.mkdir(parents=True, exist_ok=True)

  path = preds_dir / "bender_features_27.csv"
  if not path.exists():
    print("Model sweep FAIL: missing bender_features_27.csv")
    return 2

  df = pd.read_csv(path)
  df["gmax_mpa"] = pd.to_numeric(df.get("gmax_mpa"), errors="coerce")
  df = df[df["gmax_mpa"].notna()].reset_index(drop=True)
  if len(df) != 27:
    print(f"Model sweep FAIL: expected 27 rows, got {len(df)}")
    return 2

  feature_cols = [c for c in df.columns if c not in ("sector", "lon", "lat", "gmax_mpa", "ll", "pl", "pi", "nearest_grid_dist_m")]
  Xdf = df[feature_cols].apply(pd.to_numeric, errors="coerce")
  for c in feature_cols:
    if Xdf[c].isna().any():
      Xdf[c] = Xdf[c].fillna(float(Xdf[c].median()))
  X = Xdf.to_numpy(dtype=np.float64)
  y = df["gmax_mpa"].to_numpy(dtype=np.float64)

  groups = _spatial_groups_utm(df["lon"].to_numpy(dtype=np.float64), df["lat"].to_numpy(dtype=np.float64), float(args.block_m))
  n_groups = int(len(np.unique(groups)))
  n_splits = int(min(max(2, args.n_splits), n_groups))
  gkf = GroupKFold(n_splits=n_splits)

  results: List[Dict[str, Any]] = []
  for cand in _candidates():
    fold_rows: List[Dict[str, Any]] = []
    for fold, (tr, te) in enumerate(gkf.split(X, y, groups=groups), start=1):
      pred = _fit_predict(cand, X[tr], y[tr], X[te], feature_cols)
      fold_rows.append(
        {
          "fold": int(fold),
          "n_train": int(len(tr)),
          "n_test": int(len(te)),
          "r2": float(r2_score(y[te], pred)) if len(te) >= 3 else None,
          "rmse": _rmse(y[te], pred),
          "mae": float(mean_absolute_error(y[te], pred)),
        }
      )

    r2_vals = [r["r2"] for r in fold_rows if r.get("r2") is not None]
    results.append(
      {
        "name": cand.name,
        "kind": cand.kind,
        "params": cand.params,
        "n_splits": n_splits,
        "block_m": float(args.block_m),
        "rmse_mean": float(np.mean([r["rmse"] for r in fold_rows])),
        "mae_mean": float(np.mean([r["mae"] for r in fold_rows])),
        "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
        "folds": fold_rows,
      }
    )

  results_sorted = sorted(results, key=lambda r: float(r["rmse_mean"]))
  best = results_sorted[0]

  report = {
    "generated_at": _now_iso(),
    "dataset": str(path),
    "n": int(len(df)),
    "n_groups": n_groups,
    "feature_cols": feature_cols,
    "results": results_sorted,
    "best": {k: best[k] for k in ("name", "kind", "params", "rmse_mean", "mae_mean", "r2_mean")},
  }
  report_path = metrics_dir / "model_sweep_report.json"
  report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

  best_cand = next(c for c in _candidates() if c.name == best["name"])
  if best_cand.kind != "dummy":
    if best_cand.kind == "ridge":
      m = Ridge(alpha=float(best_cand.params["alpha"]))
    elif best_cand.kind == "enet":
      m = ElasticNet(alpha=float(best_cand.params["alpha"]), l1_ratio=float(best_cand.params["l1_ratio"]), max_iter=5000)
    else:
      mono = _monotone_for_cols(feature_cols)
      m = XGBRegressor(
        objective="reg:squarederror",
        random_state=42,
        n_jobs=1,
        monotone_constraints=mono,
        **best_cand.params,
      )
    m.fit(X, y)
    with (models_dir / "best_gmax_model.pkl").open("wb") as f:
      pickle.dump({"model": m, "feature_cols": feature_cols, "best": best}, f)

  print(str(report_path))
  print(json.dumps(report["best"], indent=2))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())

