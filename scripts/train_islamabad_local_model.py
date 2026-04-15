from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline


def to_float(x: Any) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    s = str(x).strip()
    if s == "":
        return None
    try:
        v = float(s)
    except Exception:
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def eval_regression(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float | None]:
    if y_true.size == 0:
        return {"mae": None, "rmse": None, "r2": None}
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred)) if y_true.size >= 3 else None
    return {"mae": mae, "rmse": rmse, "r2": r2}


def build_preprocessor(numeric_cols: list[str]) -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[("num", Pipeline([("impute", SimpleImputer(strategy="median"))]), numeric_cols)],
        remainder="drop",
    )


@dataclass(frozen=True)
class SplitSpec:
    test_size: float = 0.2
    val_size: float = 0.2
    seed: int = 42


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="CSV produced by build_islamabad_training_points.py")
    ap.add_argument("--out-dir", default="data/training/islamabad_v1", help="Output folder")
    ap.add_argument(
        "--targets",
        default=None,
        help="Comma-separated target columns. If omitted, trains on all numeric non-feature columns.",
    )
    ap.add_argument(
        "--group-col",
        default=None,
        help="Optional column to group by for splitting (e.g., site_id, borehole_id).",
    )
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    ds_path = (root / args.dataset).resolve()
    out_dir = (root / args.out_dir).resolve()
    models_dir = out_dir / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(ds_path)
    if df.empty:
        raise SystemExit("Dataset is empty")

    n_rows = int(len(df))

    exclude = {"lon", "lat", "x", "y"}
    layer_cols = [c for c in df.columns if c not in exclude and c in {"dem", "bulk_density", "sand_pct", "silt_pct", "clay_pct", "vs30", "water_content", "land_cover", "bedrock_depth_10km"}]
    if not layer_cols:
        layer_cols = [c for c in df.columns if c not in exclude and c.endswith(".tif") is False and c in df.columns]

    feature_cols = [c for c in layer_cols if c in df.columns]

    if args.targets:
        target_cols = [t.strip() for t in str(args.targets).split(",") if t.strip()]
    else:
        numeric = df.apply(lambda s: pd.to_numeric(s, errors="coerce")).select_dtypes(include=["number"]).columns.tolist()
        target_cols = [c for c in numeric if c not in exclude and c not in feature_cols]

    target_cols = [c for c in target_cols if c in df.columns]
    if not target_cols:
        raise SystemExit("No target columns found. Pass --targets col1,col2")

    X_all = df[feature_cols].copy()
    numeric_cols = feature_cols
    pre = build_preprocessor(numeric_cols)

    split = SplitSpec()
    idx_all = np.arange(n_rows)

    if n_rows < 5:
        report: dict[str, Any] = {
            "dataset": str(ds_path),
            "n_rows": n_rows,
            "features": feature_cols,
            "targets": {},
            "split": {
                "group_col": None,
                "n_train": n_rows,
                "n_val": 0,
                "n_test": 0,
                "note": "dataset too small for train/val/test split; add more rows",
            },
        }
        if args.targets:
            target_cols_small = [t.strip() for t in str(args.targets).split(",") if t.strip()]
        else:
            numeric = df.apply(lambda s: pd.to_numeric(s, errors="coerce")).select_dtypes(include=["number"]).columns.tolist()
            target_cols_small = [c for c in numeric if c not in exclude and c not in feature_cols]
        target_cols_small = [c for c in target_cols_small if c in df.columns]
        for target in target_cols_small:
            report["targets"][target] = {
                "skipped": True,
                "reason": {"n_rows": n_rows, "min_rows": 5},
            }
        (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(str(out_dir / "report.json"))
        return

    group_col = args.group_col
    if group_col is None:
        for cand in ["site_id", "borehole_id", "station_id"]:
            if cand in df.columns:
                group_col = cand
                break

    if group_col and group_col in df.columns and df[group_col].nunique(dropna=False) >= 2:
        groups = df[group_col].astype(str).to_numpy()
        gss = GroupShuffleSplit(n_splits=1, test_size=split.test_size, random_state=split.seed)
        train_val_idx, test_idx = next(gss.split(idx_all, groups=groups))
        groups_tv = groups[train_val_idx]
        gss2 = GroupShuffleSplit(n_splits=1, test_size=split.val_size, random_state=split.seed)
        train_idx, val_idx_rel = next(gss2.split(train_val_idx, groups=groups_tv))
        val_idx = train_val_idx[val_idx_rel]
        train_idx = train_val_idx[train_idx]
    else:
        train_val_idx, test_idx = train_test_split(idx_all, test_size=split.test_size, random_state=split.seed)
        train_idx, val_idx = train_test_split(train_val_idx, test_size=split.val_size, random_state=split.seed)

    report: dict[str, Any] = {
        "dataset": str(ds_path),
        "n_rows": int(len(df)),
        "features": feature_cols,
        "targets": {},
        "split": {
            "group_col": group_col,
            "n_train": int(len(train_idx)),
            "n_val": int(len(val_idx)),
            "n_test": int(len(test_idx)),
        },
    }

    base = HistGradientBoostingRegressor(
        loss="squared_error",
        random_state=split.seed,
        early_stopping=True,
        validation_fraction=0.2,
        max_iter=600,
    )
    pipe = Pipeline([("pre", pre), ("m", base)])

    try:
        import joblib  # type: ignore
    except Exception as e:
        raise SystemExit(f"Missing dependency 'joblib': {e}")

    for target in target_cols:
        y_raw = df[target].map(to_float).to_numpy(dtype=float)
        ok = np.isfinite(y_raw)
        train_mask = ok.copy()
        train_mask[test_idx] = False

        n_total = int(ok.sum())
        n_train = int(ok[train_idx].sum())
        n_test = int(ok[test_idx].sum())
        if n_total < 5 or n_train < 3 or n_test < 1:
            report["targets"][target] = {
                "skipped": True,
                "reason": {"n_total": n_total, "n_train": n_train, "n_test": n_test},
            }
            continue

        fit_idx = np.intersect1d(train_idx, np.where(ok)[0])
        pipe.fit(X_all.iloc[fit_idx], y_raw[fit_idx])

        def pred(idxs: np.ndarray) -> np.ndarray:
            ii = np.intersect1d(idxs, np.where(ok)[0])
            if ii.size == 0:
                return np.array([], dtype=float)
            return pipe.predict(X_all.iloc[ii])

        pred_train = pred(train_idx)
        pred_val = pred(val_idx)
        pred_test = pred(test_idx)

        y_train = y_raw[np.intersect1d(train_idx, np.where(ok)[0])]
        y_val = y_raw[np.intersect1d(val_idx, np.where(ok)[0])]
        y_test = y_raw[np.intersect1d(test_idx, np.where(ok)[0])]

        report["targets"][target] = {
            "skipped": False,
            "n": {"train": int(y_train.size), "val": int(y_val.size), "test": int(y_test.size)},
            "metrics": {
                "train": eval_regression(y_train, pred_train),
                "val": eval_regression(y_val, pred_val),
                "test": eval_regression(y_test, pred_test),
            },
        }

        joblib.dump(pipe, models_dir / f"{target}.joblib")

    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_dir / "report.json"))


if __name__ == "__main__":
    main()
