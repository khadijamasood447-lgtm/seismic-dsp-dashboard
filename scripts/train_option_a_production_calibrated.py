from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


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
    rmse = float(mean_squared_error(y_true, y_pred, squared=False))
    r2 = float(r2_score(y_true, y_pred)) if y_true.size >= 3 else None
    return {"mae": mae, "rmse": rmse, "r2": r2}


def build_preprocessor(numeric_cols: list[str], cat_cols: list[str]) -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            ("num", Pipeline([("impute", SimpleImputer(strategy="median"))]), numeric_cols),
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


@dataclass(frozen=True)
class TargetSpec:
    name: str
    min_train: int = 20
    min_val: int = 8
    min_test: int = 5


def make_weights(y: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=float)
    w = 1.0 + np.log1p(np.clip(y, 0, None))
    return w


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"

    feats = pd.read_csv(ds_dir / "features_option_a.csv")
    targets = pd.read_csv(ds_dir / "targets_option_a.csv")
    df = feats.merge(targets, on=["test_id", "family", "split"], how="inner")

    target_cols = [c for c in df.columns if c.startswith("N_eps_")]
    specs = [TargetSpec(c) for c in target_cols]

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
        return int(s.notna().sum()) >= 10

    numeric_cols = [c for c in numeric_cols if keep_numeric(c)]
    X_all = df[numeric_cols + cat_cols]

    pre = build_preprocessor(numeric_cols, cat_cols)
    base = HistGradientBoostingRegressor(
        loss="squared_error",
        random_state=42,
        early_stopping=True,
        validation_fraction=0.15,
        n_iter_no_change=20,
    )
    pipe = Pipeline([("pre", pre), ("m", base)])

    param_dist = {
        "m__learning_rate": [0.03, 0.05, 0.08, 0.12],
        "m__max_depth": [3, 4, 5, 6, 8],
        "m__max_iter": [200, 400, 800],
        "m__min_samples_leaf": [5, 8, 12, 20],
        "m__l2_regularization": [0.0, 0.05, 0.2, 0.8],
        "m__max_bins": [64, 128, 255],
    }

    models_dir = ds_dir / "models_calibrated"
    models_dir.mkdir(parents=True, exist_ok=True)
    preds_rows: list[dict[str, Any]] = []
    report: dict[str, Any] = {
        "dataset": str(ds_dir),
        "features_numeric": numeric_cols,
        "features_categorical": cat_cols,
        "targets": {},
        "credibility": {
            "test_holdout": "Tuning on train only; isotonic calibration on val only; test untouched until final.",
            "cv": "RandomizedSearchCV on train split only with GroupKFold grouped by test_id.",
            "sample_weight": "Weights upweight larger N to reduce long-life underprediction.",
            "calibration": "Isotonic regression fit on val predictions only (monotonic calibration).",
        },
    }

    for spec in specs:
        y_all = df[spec.name].map(to_float).to_numpy(dtype=float)
        ok = np.isfinite(y_all)
        train_mask = (df["split"] == "train").to_numpy() & ok
        val_mask = (df["split"] == "val").to_numpy() & ok
        test_mask = (df["split"] == "test").to_numpy() & ok

        if (
            int(train_mask.sum()) < spec.min_train
            or int(val_mask.sum()) < spec.min_val
            or int(test_mask.sum()) < spec.min_test
        ):
            report["targets"][spec.name] = {
                "skipped": True,
                "reason": {
                    "min_train": spec.min_train,
                    "min_val": spec.min_val,
                    "min_test": spec.min_test,
                    "n_train": int(train_mask.sum()),
                    "n_val": int(val_mask.sum()),
                    "n_test": int(test_mask.sum()),
                },
            }
            continue

        X_train = X_all[train_mask]
        y_train_raw = y_all[train_mask]
        y_train = np.log1p(y_train_raw)
        w_train = make_weights(y_train_raw)
        groups = df.loc[train_mask, "test_id"].to_numpy()

        cv = GroupKFold(n_splits=min(5, len(np.unique(groups))))
        search = RandomizedSearchCV(
            estimator=pipe,
            param_distributions=param_dist,
            n_iter=30,
            scoring="neg_mean_absolute_error",
            cv=cv,
            random_state=42,
            n_jobs=-1,
            refit=True,
            verbose=0,
        )
        search.fit(X_train, y_train, groups=groups, m__sample_weight=w_train)

        best = search.best_estimator_
        best_params = search.best_params_

        # Refit on train with weights, then calibrate on val
        best.fit(X_train, y_train, m__sample_weight=w_train)

        def predict_raw(mask: np.ndarray) -> np.ndarray:
            if int(mask.sum()) == 0:
                return np.array([], dtype=float)
            return np.expm1(best.predict(X_all[mask]))

        pred_train = predict_raw(train_mask)
        pred_val = predict_raw(val_mask)
        pred_test = predict_raw(test_mask)

        # Isotonic calibration (log-space): map predicted log1p(N) -> true log1p(N) using val only
        iso = IsotonicRegression(out_of_bounds="clip")
        val_true_log = np.log1p(y_all[val_mask])
        val_pred_log = np.log1p(np.clip(pred_val, 0, None))
        iso.fit(val_pred_log, val_true_log)

        def apply_iso(pred: np.ndarray) -> np.ndarray:
            pred_log = np.log1p(np.clip(pred, 0, None))
            cal_log = iso.transform(pred_log)
            return np.expm1(cal_log)

        pred_train_c = apply_iso(pred_train)
        pred_val_c = apply_iso(pred_val)
        pred_test_c = apply_iso(pred_test)

        # Choose calibrated only if it improves validation MAE
        val_raw = eval_regression(y_all[val_mask], pred_val)
        val_cal = eval_regression(y_all[val_mask], pred_val_c)
        use_cal = (val_cal["mae"] is not None and val_raw["mae"] is not None and val_cal["mae"] <= val_raw["mae"])  # type: ignore[operator]

        pred_train_final = pred_train_c if use_cal else pred_train
        pred_val_final = pred_val_c if use_cal else pred_val
        pred_test_final = pred_test_c if use_cal else pred_test

        metrics = {
            "n": {"train": int(train_mask.sum()), "val": int(val_mask.sum()), "test": int(test_mask.sum())},
            "train": eval_regression(y_all[train_mask], pred_train_final),
            "val": eval_regression(y_all[val_mask], pred_val_final),
            "test": eval_regression(y_all[test_mask], pred_test_final),
        }

        report["targets"][spec.name] = {
            "skipped": False,
            "best_params": best_params,
            "cv_best_score_neg_mae": float(search.best_score_),
            "calibration": {
                "type": "isotonic_log1p",
                "selected": "calibrated" if use_cal else "raw",
                "val_mae_raw": val_raw["mae"],
                "val_mae_calibrated": val_cal["mae"],
            },
            "metrics": metrics,
        }

        joblib.dump({"model": best, "calibrator": iso, "selected": "calibrated" if use_cal else "raw"}, models_dir / f"{spec.name}.joblib")

        for split_name, mask, pred in (
            ("train", train_mask, pred_train_final),
            ("val", val_mask, pred_val_final),
            ("test", test_mask, pred_test_final),
        ):
            idxs = np.where(mask)[0]
            for j, i in enumerate(idxs):
                preds_rows.append(
                    {
                        "test_id": df.iloc[i]["test_id"],
                        "family": df.iloc[i]["family"],
                        "split": split_name,
                        "target": spec.name,
                        "y_true": float(y_all[i]),
                        "y_pred": float(pred[j]),
                        "model": "calibrated",
                    }
                )

    out_report = ds_dir / "production_report_calibrated.json"
    out_report.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    preds_path = ds_dir / "predictions_production_calibrated.csv"
    if preds_rows:
        pd.DataFrame(preds_rows).to_csv(preds_path, index=False)

    print(str(out_report))


if __name__ == "__main__":
    main()
