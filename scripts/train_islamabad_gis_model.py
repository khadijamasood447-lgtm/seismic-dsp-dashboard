from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold, KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def eval_regression(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float | None]:
    if y_true.size == 0:
        return {"mae": None, "rmse": None, "r2": None}
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred)) if y_true.size >= 3 else None
    return {"mae": mae, "rmse": rmse, "r2": r2}


def build_preprocessor(numeric_cols: list[str]) -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
                        ("scale", StandardScaler(with_mean=True, with_std=True)),
                    ]
                ),
                numeric_cols,
            )
        ],
        remainder="drop",
    )


@dataclass(frozen=True)
class ModelSpec:
    name: str
    model: Any


def make_candidates(seed: int) -> list[ModelSpec]:
    return [
        ModelSpec(
            name="elasticnet",
            model=ElasticNet(alpha=0.05, l1_ratio=0.2, random_state=seed, max_iter=20000),
        ),
        ModelSpec(
            name="rf_small",
            model=RandomForestRegressor(
                n_estimators=400,
                random_state=seed,
                max_depth=6,
                min_samples_leaf=2,
                min_samples_split=4,
                n_jobs=-1,
            ),
        ),
    ]


def cross_val_mae(pipe: Pipeline, X: pd.DataFrame, y: np.ndarray, groups: np.ndarray | None, seed: int) -> float:
    if groups is not None and np.unique(groups).size >= 3:
        n_splits = min(5, int(np.unique(groups).size))
        splitter = GroupKFold(n_splits=n_splits)
        splits = splitter.split(X, y, groups=groups)
    else:
        n_splits = min(5, int(X.shape[0]))
        if X.shape[0] <= 8:
            n_splits = int(X.shape[0])
        splitter = KFold(n_splits=n_splits, shuffle=True, random_state=seed)
        splits = splitter.split(X, y)

    maes: list[float] = []
    for train_idx, test_idx in splits:
        pipe.fit(X.iloc[train_idx], y[train_idx])
        pred = pipe.predict(X.iloc[test_idx])
        maes.append(float(mean_absolute_error(y[test_idx], pred)))
    return float(np.mean(maes))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="Sampled CSV with GIS features and targets")
    ap.add_argument("--out-dir", required=True, help="Output folder")
    ap.add_argument("--targets", required=True, help="Comma-separated target columns")
    ap.add_argument("--group-col", default="site_id")
    ap.add_argument("--seed", default=42, type=int)
    ap.add_argument(
        "--include-pga",
        action="store_true",
        help="Include sector-based PGA table columns as features (not recommended for full-grid prediction).",
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

    targets = [t.strip() for t in str(args.targets).split(",") if t.strip()]
    targets = [t for t in targets if t in df.columns]
    if not targets:
        raise SystemExit("No valid targets found")

    exclude = {"site_id", "lon", "lat", "x", "y", "sector"}
    known_gis = {
        "dem",
        "bulk_density",
        "sand_pct",
        "silt_pct",
        "clay_pct",
        "vs30",
        "water_content",
        "land_cover",
        "bedrock_depth_10km",
        "sub_runoff_class",
        "sub_runoff_depth_mm_mean",
        "sub_min_elev_m",
        "sub_max_elev_m",
        "sub_area_km2",
    }
    if args.include_pga:
        known_gis |= {"pga_500", "pga_2500"}
    feature_cols = [c for c in df.columns if c in known_gis]
    if not feature_cols:
        feature_cols = [c for c in df.columns if c not in exclude and c not in targets]

    X = df[feature_cols].copy()
    numeric_cols = feature_cols
    pre = build_preprocessor(numeric_cols)
    groups = df[args.group_col].astype(str).to_numpy() if args.group_col in df.columns else None

    report: dict[str, Any] = {
        "dataset": str(ds_path),
        "n_rows": int(len(df)),
        "features": feature_cols,
        "targets": {},
        "cv": {"group_col": args.group_col if groups is not None else None},
    }

    try:
        import joblib  # type: ignore
    except Exception as e:
        raise SystemExit(f"Missing dependency 'joblib': {e}")

    for target in targets:
        y = pd.to_numeric(df[target], errors="coerce").to_numpy(dtype=float)
        ok = np.isfinite(y)
        if int(ok.sum()) < 5:
            report["targets"][target] = {"skipped": True, "reason": {"n_valid": int(ok.sum()), "min": 5}}
            continue

        X_ok = X.loc[ok].reset_index(drop=True)
        y_ok = y[ok]
        g_ok = groups[ok] if groups is not None else None

        candidates = make_candidates(args.seed)
        if int(y_ok.size) <= 12:
            candidates = [c for c in candidates if c.name == "elasticnet"]

        best: dict[str, Any] | None = None
        for spec in candidates:
            pipe = Pipeline([("pre", pre), ("m", spec.model)])
            mae = cross_val_mae(pipe, X_ok, y_ok, g_ok, args.seed)
            cand = {"name": spec.name, "cv_mae": mae}
            if best is None or mae < float(best["cv_mae"]):
                best = cand
                best_pipe = pipe

        assert best is not None
        best_pipe.fit(X_ok, y_ok)
        pred_all = best_pipe.predict(X_ok)

        report["targets"][target] = {
            "skipped": False,
            "model": best,
            "fit_metrics": eval_regression(y_ok, pred_all),
            "n": int(y_ok.size),
        }

        joblib.dump(best_pipe, models_dir / f"{target}.joblib")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_dir / "report.json"))


if __name__ == "__main__":
    main()
