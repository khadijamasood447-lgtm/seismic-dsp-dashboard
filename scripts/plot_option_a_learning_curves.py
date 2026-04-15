from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.model_selection import GroupKFold, learning_curve
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


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    feats = pd.read_csv(ds_dir / "features_option_a.csv")
    targets = pd.read_csv(ds_dir / "targets_option_a.csv")
    df = feats.merge(targets, on=["test_id", "family", "split"], how="inner")

    out_dir = ds_dir / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)

    numeric_cols = [
        "p0_kpa",
        "u0_kpa",
        "q0_kpa",
        "eps0_pct",
        "q_ampl_est_kpa",
        "csr_est",
    ]
    numeric_cols = [c for c in numeric_cols if c in df.columns]
    cat_cols = [c for c in ["family", "feature_series_type", "csr_source", "q_ampl_source"] if c in df.columns]

    X_all = df[numeric_cols + cat_cols]

    pre = build_preprocessor(numeric_cols, cat_cols)
    base = HistGradientBoostingRegressor(
        loss="squared_error",
        learning_rate=0.08,
        max_depth=5,
        max_iter=500,
        min_samples_leaf=8,
        l2_regularization=0.2,
        random_state=42,
        early_stopping=True,
    )
    model = Pipeline([("pre", pre), ("m", base)])

    targets_to_plot = ["N_eps_0_1", "N_eps_1_0"]
    train_df = df[df["split"] == "train"].copy()
    groups = train_df["test_id"].to_numpy()

    cv = GroupKFold(n_splits=min(5, len(np.unique(groups))))
    sns.set_theme(style="whitegrid")

    for tgt in targets_to_plot:
        if tgt not in df.columns:
            continue
        y = train_df[tgt].map(to_float).to_numpy(dtype=float)
        ok = np.isfinite(y)
        if int(ok.sum()) < 25:
            continue

        X = train_df.loc[ok, numeric_cols + cat_cols]
        y = np.log1p(y[ok])
        g = train_df.loc[ok, "test_id"].to_numpy()

        sizes = np.linspace(0.2, 1.0, 6)
        train_sizes, train_scores, val_scores = learning_curve(
            model,
            X,
            y,
            groups=g,
            cv=cv,
            scoring="neg_mean_absolute_error",
            train_sizes=sizes,
            n_jobs=-1,
            shuffle=True,
            random_state=42,
        )

        train_mae = -train_scores.mean(axis=1)
        val_mae = -val_scores.mean(axis=1)
        train_std = train_scores.std(axis=1)
        val_std = val_scores.std(axis=1)

        plt.figure(figsize=(7, 5))
        plt.plot(train_sizes, train_mae, marker="o", label="train MAE (log1p N)")
        plt.plot(train_sizes, val_mae, marker="o", label="cv MAE (log1p N)")
        plt.fill_between(train_sizes, train_mae - train_std, train_mae + train_std, alpha=0.15)
        plt.fill_between(train_sizes, val_mae - val_std, val_mae + val_std, alpha=0.15)
        plt.xlabel("Training samples")
        plt.ylabel("MAE")
        plt.title(f"Learning curve: {tgt}")
        plt.legend()
        plt.tight_layout()
        plt.savefig(out_dir / f"learning_curve_{tgt}.png", dpi=170)
        plt.close()

    print(str(out_dir))


if __name__ == "__main__":
    main()

