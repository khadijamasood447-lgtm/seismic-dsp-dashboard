from __future__ import annotations

import argparse
import json
import math
import pickle
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
from pyproj import Transformer
from sklearn.dummy import DummyRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
from xgboost import XGBRegressor


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
  return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def _as_num(s: Any) -> float | None:
  try:
    v = float(s)
  except Exception:
    return None
  if not math.isfinite(v):
    return None
  return v


def _spatial_groups_utm(lon: np.ndarray, lat: np.ndarray, block_m: float) -> np.ndarray:
  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  x_m, y_m = tx.transform(lon, lat)
  gx = np.floor(np.asarray(x_m, dtype=np.float64) / float(block_m)).astype(int)
  gy = np.floor(np.asarray(y_m, dtype=np.float64) / float(block_m)).astype(int)
  return gx * 1_000_000 + gy


def _extract_sector_key(sector: str) -> str:
  s = str(sector).strip().upper()
  if "(" in s:
    s = s.split("(", 1)[0].strip()
  if " " in s:
    s = s.split(" ", 1)[0].strip()
  return s


def _load_pga_table(path: Path) -> Dict[str, float]:
  if not path.exists():
    return {}
  df = pd.read_csv(path)
  if df.empty:
    return {}

  out: Dict[str, float] = {}
  for r in df.itertuples(index=False):
    sec = _extract_sector_key(getattr(r, "Sector", ""))
    v = _as_num(getattr(r, "PGA_2500", None))
    if sec and v is not None:
      out[sec] = float(v)
  return out


@dataclass(frozen=True)
class GlobalSpec:
  ds_dir: Path
  features_path: Path
  splits_path: Path


def _global_spec(root: Path) -> GlobalSpec:
  ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
  return GlobalSpec(
    ds_dir=ds_dir,
    features_path=ds_dir / "features_option_a.csv",
    splits_path=ds_dir / "splits.json",
  )


def _derive_proxy_gmax_mpa(global_feats: pd.DataFrame) -> Tuple[pd.Series, Dict[str, Any]]:
  q = pd.to_numeric(global_feats.get("t6_qampl_kpa"), errors="coerce")
  e = pd.to_numeric(global_feats.get("t6_e0"), errors="coerce")

  ok = q.notna() & e.notna() & (e > 0)
  if int(ok.sum()) < 20:
    raise RuntimeError(
      "Global cyclic dataset lacks a usable strain-amplitude column for proxy Gmax derivation. "
      "Expected t6_qampl_kpa + t6_e0 with sufficient non-missing rows."
    )

  e_med = float(np.nanmedian(e[ok].to_numpy(dtype=np.float64)))
  eps_scale = 0.01 if e_med > 0.2 else 1.0
  strain = e * eps_scale

  g_kpa = q / strain
  g_mpa = g_kpa / 1000.0
  g_mpa = g_mpa.where(np.isfinite(g_mpa), np.nan)

  meta = {
    "method": "proxy_from_t6_qampl_over_t6_e0",
    "t6_e0_median": e_med,
    "eps_scale": eps_scale,
    "note": "Proxy stiffness from cyclic stage-6 amplitude/strain; not guaranteed to equal small-strain Gmax.",
  }
  return g_mpa, meta


def _build_global_matrix(df: pd.DataFrame, families: List[str]) -> Tuple[pd.DataFrame, List[str]]:
  base = pd.DataFrame(
    {
      "p0_kpa": pd.to_numeric(df.get("p0_kpa"), errors="coerce"),
      "q0_kpa": pd.to_numeric(df.get("q0_kpa"), errors="coerce").fillna(0.0),
      "u0_kpa": pd.to_numeric(df.get("u0_kpa"), errors="coerce").fillna(0.0),
      "csr_est": pd.to_numeric(df.get("csr_est"), errors="coerce"),
      "q_ampl_est_kpa": pd.to_numeric(df.get("q_ampl_est_kpa"), errors="coerce"),
      "eps0_pct": pd.to_numeric(df.get("eps0_pct"), errors="coerce").fillna(0.0),
    }
  )

  fam = df.get("family")
  fam = fam.astype(str).str.upper().fillna("") if fam is not None else pd.Series([""] * len(df))
  for f in families:
    base[f"family_{f}"] = (fam == f).astype(int)

  cols = base.columns.tolist()
  for c in cols:
    if base[c].isna().any():
      base[c] = base[c].fillna(float(base[c].median()))
  return base, cols


def _infer_bulk_density_g_cm3(v: float) -> float:
  if not math.isfinite(v):
    return float("nan")
  if v > 20.0:
    return float(v) * 0.01
  return float(v)


def _sector_pga_g(sector: str, pga_table: Dict[str, float]) -> float:
  key = _extract_sector_key(sector)
  v = pga_table.get(key)
  if v is None:
    return 0.02
  return float(v) / 100.0 if v > 0.2 else float(v)


def _islamabad_to_cyclic_features(row: pd.Series, *, pga_table: Dict[str, float], depth_m: float = 2.0) -> Dict[str, float]:
  bulk_raw = float(pd.to_numeric(row.get("bulk_density"), errors="coerce"))
  bulk_g_cm3 = _infer_bulk_density_g_cm3(bulk_raw)
  if not math.isfinite(bulk_g_cm3) or bulk_g_cm3 <= 0:
    bulk_g_cm3 = 1.8

  sigma_v_kpa = bulk_g_cm3 * 9.81 * float(depth_m)
  sigma_v_prime_kpa = sigma_v_kpa

  k0 = 0.5
  p0_kpa = sigma_v_prime_kpa * (1.0 + 2.0 * k0) / 3.0
  q0_kpa = 0.0
  u0_kpa = 0.0

  pga_g = _sector_pga_g(str(row.get("sector", "")), pga_table)
  rd = max(0.7, 1.0 - 0.00765 * float(depth_m))

  silt = float(pd.to_numeric(row.get("silt_pct"), errors="coerce"))
  clay = float(pd.to_numeric(row.get("clay_pct"), errors="coerce"))
  fines = 0.0
  if math.isfinite(silt):
    fines += silt
  if math.isfinite(clay):
    fines += clay

  if fines <= 5:
    k_sigma = 1.0
  elif fines <= 35:
    k_sigma = 1.0 + (fines - 5.0) / 60.0
  else:
    k_sigma = 1.5

  csr_est = 0.65 * (sigma_v_kpa / max(1e-6, sigma_v_prime_kpa)) * pga_g * rd * k_sigma
  csr_est = float(max(0.05, min(0.5, csr_est)))

  q_ampl_est_kpa = csr_est * 2.0 * p0_kpa
  eps0_pct = 0.0
  return {
    "p0_kpa": float(p0_kpa),
    "q0_kpa": float(q0_kpa),
    "u0_kpa": float(u0_kpa),
    "csr_est": float(csr_est),
    "q_ampl_est_kpa": float(q_ampl_est_kpa),
    "eps0_pct": float(eps0_pct),
  }


def _train_xgb(seed: int, monotone: str) -> XGBRegressor:
  return XGBRegressor(
    n_estimators=200,
    max_depth=4,
    learning_rate=0.03,
    subsample=0.7,
    colsample_bytree=0.7,
    reg_lambda=10.0,
    reg_alpha=5.0,
    min_child_weight=5.0,
    objective="reg:squarederror",
    random_state=int(seed),
    n_jobs=1,
    monotone_constraints=monotone,
  )


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--depth-m", type=float, default=2.0)
  ap.add_argument("--local-weight", type=float, default=10.0)
  ap.add_argument("--global-weight", type=float, default=1.0)
  ap.add_argument("--block-m", type=float, default=2000.0)
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
    print("Phase 3 FAIL: missing Phase 1 outputs")
    return 2

  grid = pd.read_csv(grid_path)
  targets = pd.read_csv(targets_path)
  targets["gmax_mpa"] = pd.to_numeric(targets.get("gmax_mpa"), errors="coerce")
  targets = targets[targets["gmax_mpa"].notna()].reset_index(drop=True)
  if len(targets) != 27:
    print(f"Phase 3 FAIL: expected 27 bender points, got {len(targets)}")
    return 2

  tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  gx, gy = tx.transform(grid["lon"].to_numpy(dtype=float), grid["lat"].to_numpy(dtype=float))
  px, py = tx.transform(targets["lon"].to_numpy(dtype=float), targets["lat"].to_numpy(dtype=float))
  from sklearn.neighbors import KDTree

  tree = KDTree(np.column_stack([gx, gy]))
  dist, ind = tree.query(np.column_stack([px, py]), k=1)
  ind = ind.ravel()
  targets_raw = targets.copy()
  for c in ["sand_pct", "silt_pct", "clay_pct", "bulk_density", "water_content"]:
    if c in grid.columns:
      targets_raw[c] = pd.to_numeric(grid.iloc[ind][c].to_numpy(), errors="coerce")

  pga_table = _load_pga_table(REPO_ROOT / "ISLAMABD DATA" / "pga_islamabad.csv")

  local_rows: List[Dict[str, Any]] = []
  for r in targets_raw.itertuples(index=False):
    row = pd.Series(r._asdict())
    cyc = _islamabad_to_cyclic_features(row, pga_table=pga_table, depth_m=float(args.depth_m))
    cyc["gmax_mpa"] = float(pd.to_numeric(row.get("gmax_mpa"), errors="coerce"))
    cyc["sector"] = str(row.get("sector", ""))
    cyc["lon"] = float(pd.to_numeric(row.get("lon"), errors="coerce"))
    cyc["lat"] = float(pd.to_numeric(row.get("lat"), errors="coerce"))
    local_rows.append(cyc)

  local_df = pd.DataFrame(local_rows)
  local_df = local_df.replace([np.inf, -np.inf], np.nan).dropna(subset=["gmax_mpa", "lon", "lat"]).reset_index(drop=True)
  if len(local_df) != 27:
    print(f"Phase 3 FAIL: Islamabad cyclic-mapped rows not equal to 27 ({len(local_df)})")
    return 2

  gs = _global_spec(REPO_ROOT)
  global_used = bool(gs.features_path.exists() and gs.splits_path.exists())
  global_meta: Dict[str, Any] = {"used": global_used, "path": str(gs.ds_dir)}
  global_proxy_meta: Dict[str, Any] | None = None

  feature_base = ["p0_kpa", "q0_kpa", "u0_kpa", "csr_est", "q_ampl_est_kpa", "eps0_pct"]
  families: List[str] = []

  if global_used:
    gfeats = pd.read_csv(gs.features_path)
    gfeats["test_id"] = gfeats["test_id"].astype(str)
    gfeats["family"] = gfeats["family"].astype(str).str.upper()
    gmax_proxy, global_proxy_meta = _derive_proxy_gmax_mpa(gfeats)
    gfeats["gmax_mpa"] = gmax_proxy

    splits = json.loads(gs.splits_path.read_text(encoding="utf-8"))
    train_ids = set([str(x) for x in splits.get("train", [])])
    val_ids = set([str(x) for x in splits.get("val", [])])
    test_ids = set([str(x) for x in splits.get("test", [])])
    gfeats["split"] = gfeats["test_id"].map(lambda t: "train" if t in train_ids else ("val" if t in val_ids else ("test" if t in test_ids else None)))

    gfeats = gfeats[gfeats["split"].notna()].reset_index(drop=True)
    gfeats["gmax_mpa"] = pd.to_numeric(gfeats["gmax_mpa"], errors="coerce")
    gfeats = gfeats[gfeats["gmax_mpa"].notna()].reset_index(drop=True)

    families = sorted([f for f in gfeats["family"].unique().tolist() if f])
    Xg_df, all_cols = _build_global_matrix(gfeats, families)
    yg = gfeats["gmax_mpa"].to_numpy(dtype=np.float64)

    global_meta.update(
      {
        "n_rows": int(len(gfeats)),
        "families": families,
        "splits": {
          "train": int((gfeats["split"] == "train").sum()),
          "val": int((gfeats["split"] == "val").sum()),
          "test": int((gfeats["split"] == "test").sum()),
        },
        "proxy": global_proxy_meta,
      }
    )
  else:
    Xg_df = None
    yg = None
    all_cols = feature_base
    global_meta.update({"reason": "Missing cyclic_triaxial_v4 features_option_a.csv or splits.json"})

  Xl_df = pd.DataFrame({c: pd.to_numeric(local_df[c], errors="coerce") for c in feature_base})
  for c in feature_base:
    if Xl_df[c].isna().any():
      Xl_df[c] = Xl_df[c].fillna(float(Xl_df[c].median()))
  for f in families:
    Xl_df[f"family_{f}"] = 0

  Xl_df = Xl_df[[c for c in all_cols if c in Xl_df.columns]].copy()
  for c in all_cols:
    if c not in Xl_df.columns:
      Xl_df[c] = 0.0
  Xl_df = Xl_df[all_cols]

  X_local = Xl_df.to_numpy(dtype=np.float32)
  y_local = local_df["gmax_mpa"].to_numpy(dtype=np.float64)

  if Xg_df is not None and yg is not None:
    X_global = Xg_df[all_cols].to_numpy(dtype=np.float32)
    y_global = yg
  else:
    X_global = np.zeros((0, len(all_cols)), dtype=np.float32)
    y_global = np.zeros((0,), dtype=np.float64)

  dummy = DummyRegressor(strategy="mean")
  dummy.fit(X_local, y_local)
  dummy_rmse = _rmse(y_local, dummy.predict(X_local))

  seeds = [42, 123, 456, 789, 101112]
  monotone = "(" + ",".join(["1" if c == "p0_kpa" else "0" for c in all_cols]) + ")"

  def run_cv(block_m: float, n_splits_target: int) -> Dict[str, Any]:
    groups = _spatial_groups_utm(
      local_df["lon"].to_numpy(dtype=float),
      local_df["lat"].to_numpy(dtype=float),
      block_m=float(block_m),
    )
    n_groups = int(len(np.unique(groups)))
    n_splits = int(min(max(2, n_splits_target), n_groups))
    gkf = GroupKFold(n_splits=n_splits)

    cv_rows: List[Dict[str, Any]] = []
    for fold, (tr, te) in enumerate(gkf.split(X_local, y_local, groups=groups), start=1):
      preds_f: List[np.ndarray] = []
      for seed in seeds:
        m = _train_xgb(seed, monotone)
        if X_global.shape[0] > 0:
          m.fit(X_global, y_global, sample_weight=np.full(X_global.shape[0], float(args.global_weight)))
          m.fit(
            X_local[tr],
            y_local[tr],
            sample_weight=np.full(len(tr), float(args.local_weight)),
            xgb_model=m.get_booster(),
          )
        else:
          m.fit(X_local[tr], y_local[tr], sample_weight=np.full(len(tr), float(args.local_weight)))
        preds_f.append(m.predict(X_local[te]))

      pred = np.mean(np.stack(preds_f, axis=0), axis=0)
      cv_rows.append(
        {
          "fold": int(fold),
          "n_train": int(len(tr)),
          "n_test": int(len(te)),
          "r2": float(r2_score(y_local[te], pred)) if len(te) >= 3 else None,
          "rmse": _rmse(y_local[te], pred),
          "mae": float(mean_absolute_error(y_local[te], pred)),
        }
      )

    r2_vals = [r["r2"] for r in cv_rows if r.get("r2") is not None]
    return {
      "method": "GroupKFold",
      "block_m": float(block_m),
      "n_splits": int(n_splits),
      "folds": cv_rows,
      "r2_mean": float(np.mean(r2_vals)) if r2_vals else float("nan"),
      "rmse_mean": float(np.mean([r["rmse"] for r in cv_rows])) if cv_rows else float("nan"),
      "mae_mean": float(np.mean([r["mae"] for r in cv_rows])) if cv_rows else float("nan"),
    }

  cv_strict = run_cv(block_m=2000.0, n_splits_target=5)
  cv_practical = run_cv(block_m=1000.0, n_splits_target=3)

  ens: List[XGBRegressor] = []
  for seed in seeds:
    m = _train_xgb(seed, monotone)
    if X_global.shape[0] > 0:
      m.fit(X_global, y_global, sample_weight=np.full(X_global.shape[0], float(args.global_weight)))
      m.fit(X_local, y_local, sample_weight=np.full(X_local.shape[0], float(args.local_weight)), xgb_model=m.get_booster())
    else:
      m.fit(X_local, y_local, sample_weight=np.full(X_local.shape[0], float(args.local_weight)))
    ens.append(m)

  model_path = models_dir / "model_ensemble_5.pkl"
  with model_path.open("wb") as f:
    pickle.dump({"models": ens, "feature_cols": all_cols, "seeds": seeds}, f)

  global_model_path = models_dir / "global_pretrained.pkl"
  if X_global.shape[0] > 0:
    g0 = _train_xgb(42, monotone)
    g0.fit(X_global, y_global, sample_weight=np.full(X_global.shape[0], float(args.global_weight)))
    with global_model_path.open("wb") as f:
      pickle.dump({"model": g0, "feature_cols": all_cols, "proxy": global_proxy_meta}, f)

  features_list_path = models_dir / "global_features_list.json"
  features_list_path.write_text(json.dumps(all_cols, indent=2), encoding="utf-8")

  r2_mean = float(cv_strict["r2_mean"])
  rmse_mean = float(cv_strict["rmse_mean"])
  ok = bool(np.isfinite(r2_mean) and r2_mean > -0.5)
  report = {
    "phase": 3,
    "generated_at": _now_iso(),
    "ok": ok,
    "global": global_meta,
    "local": {
      "n_rows": int(len(local_df)),
      "weight": float(args.local_weight),
      "depth_m": float(args.depth_m),
      "block_m": float(args.block_m),
      "pga_table_rows": int(len(pga_table)),
    },
    "features": {"count": int(len(all_cols)), "columns": all_cols},
    "cv": {"strict": cv_strict, "practical": cv_practical},
    "baseline": {"dummy_mean_rmse": float(dummy_rmse)},
    "outputs": {
      "model_ensemble_5": str(model_path),
      "global_pretrained": str(global_model_path) if global_model_path.exists() else None,
      "global_features_list": str(features_list_path),
    },
  }
  (metrics_dir / "training_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

  print(f"Phase 3 {'PASS' if ok else 'WARN'}")
  print(str(model_path))
  print(str(metrics_dir / 'training_report.json'))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
