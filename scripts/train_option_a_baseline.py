from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


def to_float(x: Any) -> float | None:
    if x is None:
        return None
    if isinstance(x, (int, float)):
        if math.isnan(float(x)) or math.isinf(float(x)):
            return None
        return float(x)
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


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    feats_path = ds_dir / "features_option_a.csv"
    targets_path = ds_dir / "targets_option_a.csv"

    feats = pd.read_csv(feats_path)
    targets = pd.read_csv(targets_path)
    df = feats.merge(targets, on=["test_id", "family", "split"], how="inner").copy()
    target_cols = [c for c in df.columns if c.startswith("N_eps_")]

    numeric_cols = [
        "p0_kpa",
        "u0_kpa",
        "q0_kpa",
        "eps0_pct",
        "eps_ampl0",
        "eps_ampl_med_first30",
        "q_ampl_est_kpa",
        "csr_est",
    ]
    numeric_cols = [c for c in numeric_cols if c in df.columns]

    cat_cols = [c for c in ["family", "feature_series_type", "csr_source", "q_ampl_source"] if c in df.columns]

    train_mask_all = (df["split"] == "train").to_numpy()

    def keep_numeric(col: str) -> bool:
        s = df.loc[train_mask_all, col].map(to_float)
        return int(s.notna().sum()) >= 5

    numeric_cols = [c for c in numeric_cols if keep_numeric(c)]

    X = df[numeric_cols + cat_cols]

    pre = ColumnTransformer(
        transformers=[
            ("num", Pipeline([( "impute", SimpleImputer(strategy="median") )]), numeric_cols),
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        ("oh", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                cat_cols,
            ),
        ],
        remainder="drop",
    )

    base = HistGradientBoostingRegressor(
        loss="squared_error",
        learning_rate=0.06,
        max_depth=6,
        max_iter=400,
        min_samples_leaf=8,
        l2_regularization=0.2,
        random_state=42,
    )
    model = Pipeline([("pre", pre), ("m", base)])

    def eval_one(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
        return {
            "mae": float(mean_absolute_error(y_true, y_pred)),
            "r2": float(r2_score(y_true, y_pred)) if len(y_true) >= 3 else None,
        }

    results: dict[str, Any] = {}
    for tgt in target_cols:
        y_all = df[tgt].map(to_float).to_numpy(dtype=float)
        ok = np.isfinite(y_all)
        if ok.sum() < 8:
            continue

        train_mask = (df["split"] == "train").to_numpy() & ok
        val_mask = (df["split"] == "val").to_numpy() & ok
        test_mask = (df["split"] == "test").to_numpy() & ok

        y_train = np.log1p(y_all[train_mask])
        model.fit(X[train_mask], y_train)

        out: dict[str, Any] = {
            "n": {
                "train": int(train_mask.sum()),
                "val": int(val_mask.sum()),
                "test": int(test_mask.sum()),
            }
        }

        for name, mask in ("train", train_mask), ("val", val_mask), ("test", test_mask):
            if mask.sum() == 0:
                out[name] = None
                continue
            pred = np.expm1(model.predict(X[mask]))
            out[name] = eval_one(y_all[mask], pred)
        results[tgt] = out

    report = {
        "dataset": str(ds_dir),
        "targets": list(results.keys()),
        "features_numeric": numeric_cols,
        "features_categorical": cat_cols,
        "per_target": results,
    }

    out_path = ds_dir / "baseline_report.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
