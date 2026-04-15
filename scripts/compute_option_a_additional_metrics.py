from __future__ import annotations

import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


def safe_log1p(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    x = np.where(np.isfinite(x), x, np.nan)
    x = np.where(x < 0, np.nan, x)
    return np.log1p(x)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    preds_path = ds_dir / "predictions_production.csv"
    if not preds_path.exists():
        raise SystemExit("Missing predictions_production.csv. Run scripts/train_option_a_production.py")

    preds = pd.read_csv(preds_path)
    test = preds[preds["split"] == "test"].copy()
    if test.empty:
        raise SystemExit("No test predictions found")

    sns.set_theme(style="whitegrid")
    out_dir = ds_dir / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for tgt, g in test.groupby("target"):
        y = g["y_true"].to_numpy(dtype=float)
        p = g["y_pred"].to_numpy(dtype=float)
        if y.size == 0:
            continue

        mae = float(np.mean(np.abs(p - y)))
        rmse = float(np.sqrt(np.mean((p - y) ** 2)))
        ybar = float(np.mean(y))
        ss_res = float(np.sum((y - p) ** 2))
        ss_tot = float(np.sum((y - ybar) ** 2))
        r2 = None if ss_tot <= 0 else float(1.0 - ss_res / ss_tot)

        y_log = safe_log1p(y)
        p_log = safe_log1p(p)
        ok = np.isfinite(y_log) & np.isfinite(p_log)
        mae_log = float(np.mean(np.abs(p_log[ok] - y_log[ok]))) if ok.any() else None
        rmse_log = float(np.sqrt(np.mean((p_log[ok] - y_log[ok]) ** 2))) if ok.any() else None

        # Relative error (MAPE) - N is >= 1 for these targets, so safe
        mape = float(np.mean(np.abs((p - y) / y))) * 100.0

        rows.append(
            {
                "target": tgt,
                "n": int(y.size),
                "mae": mae,
                "rmse": rmse,
                "r2": r2,
                "mae_log1p": mae_log,
                "rmse_log1p": rmse_log,
                "mape_pct": mape,
                "y_median": float(np.median(y)),
                "y_p90": float(np.percentile(y, 90)),
            }
        )

    dfm = pd.DataFrame(rows).sort_values("target")
    dfm.to_csv(out_dir / "test_metrics_additional.csv", index=False)

    # Plot log-space MAE and MAPE
    fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True)
    sns.barplot(data=dfm, x="target", y="mae_log1p", ax=axes[0], color="#4C78A8")
    axes[0].set_ylabel("MAE on log1p(N)")
    axes[0].set_title("Test Metrics (Log-space + Relative Error)")

    sns.barplot(data=dfm, x="target", y="mape_pct", ax=axes[1], color="#F58518")
    axes[1].set_ylabel("MAPE (%)")
    axes[1].set_xlabel("Target")
    axes[1].tick_params(axis="x", rotation=45)
    plt.tight_layout()
    plt.savefig(out_dir / "test_metrics_log_mape.png", dpi=180)
    plt.close(fig)

    # Log-scale predicted vs true (all targets)
    test2 = test.copy()
    test2["y_true_log"] = np.log1p(test2["y_true"].clip(lower=0))
    test2["y_pred_log"] = np.log1p(test2["y_pred"].clip(lower=0))
    plt.figure(figsize=(8, 6))
    sns.scatterplot(data=test2, x="y_true_log", y="y_pred_log", hue="target", style="family", s=70, alpha=0.85)
    lo = float(min(test2["y_true_log"].min(), test2["y_pred_log"].min()))
    hi = float(max(test2["y_true_log"].max(), test2["y_pred_log"].max()))
    pad = 0.05 * (hi - lo) if hi > lo else 0.5
    lo -= pad
    hi += pad
    plt.plot([lo, hi], [lo, hi], color="black", linewidth=1)
    plt.xlim(lo, hi)
    plt.ylim(lo, hi)
    plt.xlabel("True log1p(N)")
    plt.ylabel("Predicted log1p(N)")
    plt.title("Production Predictions (Test): Log1p Scale")
    plt.legend(bbox_to_anchor=(1.02, 1), loc="upper left", borderaxespad=0)
    plt.tight_layout()
    plt.savefig(out_dir / "predictions_test_overview_log.png", dpi=170)
    plt.close()

    print(str(out_dir))


if __name__ == "__main__":
    main()

