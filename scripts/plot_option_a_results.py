from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    preds_path = ds_dir / "predictions_production.csv"
    report_path = ds_dir / "production_report.json"

    if not preds_path.exists() or not report_path.exists():
        raise SystemExit("Run scripts/train_option_a_production.py first")

    out_dir = ds_dir / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)

    preds = pd.read_csv(preds_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    targets = sorted(preds["target"].unique())

    sns.set_theme(style="whitegrid")

    # Summary metrics table (test only)
    rows = []
    for t in targets:
        info = report["targets"].get(t)
        if not info or info.get("skipped"):
            continue
        m = info["metrics"]["test"]
        rows.append({"target": t, "mae": m["mae"], "rmse": m["rmse"], "r2": m["r2"]})
    if rows:
        df_metrics = pd.DataFrame(rows).sort_values("target")
        try:
            df_metrics.to_csv(out_dir / "test_metrics_summary.csv", index=False)
        except PermissionError:
            df_metrics.to_csv(out_dir / "test_metrics_summary_v2.csv", index=False)

    # Metrics summary plot (MAE/RMSE/R2)
    if rows:
        dfm = df_metrics
        fig, axes = plt.subplots(3, 1, figsize=(11, 9), sharex=True)
        sns.barplot(data=dfm, x="target", y="mae", ax=axes[0], color="#4C78A8")
        axes[0].set_ylabel("MAE (cycles)")
        axes[0].set_title("Test Metrics Summary")

        sns.barplot(data=dfm, x="target", y="rmse", ax=axes[1], color="#F58518")
        axes[1].set_ylabel("RMSE (cycles)")

        sns.barplot(data=dfm, x="target", y="r2", ax=axes[2], color="#54A24B")
        axes[2].set_ylabel("R²")
        axes[2].axhline(0.0, color="black", linewidth=1)
        axes[2].set_xlabel("Target")

        for ax in axes:
            ax.tick_params(axis="x", rotation=45)
        plt.tight_layout()
        plt.savefig(out_dir / "test_metrics_summary.png", dpi=180)
        plt.close(fig)

    # Plots per target
    for t in targets:
        d = preds[preds["target"] == t].copy()
        if d.empty:
            continue

        test = d[d["split"] == "test"]
        train = d[d["split"] == "train"]

        if not test.empty:
            lo = float(min(test["y_true"].min(), test["y_pred"].min()))
            hi = float(max(test["y_true"].max(), test["y_pred"].max()))
        else:
            lo = float(min(d["y_true"].min(), d["y_pred"].min()))
            hi = float(max(d["y_true"].max(), d["y_pred"].max()))

        pad = 0.05 * (hi - lo) if hi > lo else 1.0
        lo -= pad
        hi += pad

        # Pred vs true
        plt.figure(figsize=(7, 6))
        if not train.empty:
            plt.scatter(train["y_true"], train["y_pred"], s=25, alpha=0.35, label="train")
        if not test.empty:
            plt.scatter(test["y_true"], test["y_pred"], s=45, alpha=0.8, label="test")
        plt.plot([lo, hi], [lo, hi], color="black", linewidth=1)
        plt.xlim(lo, hi)
        plt.ylim(lo, hi)
        plt.xlabel("True N")
        plt.ylabel("Predicted N")
        plt.title(f"{t}: Predicted vs True")
        plt.legend()
        plt.tight_layout()
        plt.savefig(out_dir / f"scatter_{t}.png", dpi=160)
        plt.close()

        # Residuals on test
        if not test.empty:
            resid = test["y_pred"] - test["y_true"]
            plt.figure(figsize=(7, 4))
            sns.histplot(resid, bins=20, kde=True)
            plt.axvline(0.0, color="black", linewidth=1)
            plt.xlabel("Residual (Pred - True)")
            plt.title(f"{t}: Test residual distribution")
            plt.tight_layout()
            plt.savefig(out_dir / f"residuals_{t}.png", dpi=160)
            plt.close()

    # Overall: MAE by target (test)
    if rows:
        dfm = df_metrics
        plt.figure(figsize=(10, 5))
        sns.barplot(data=dfm, x="target", y="mae", color="#4C78A8")
        plt.xticks(rotation=45, ha="right")
        plt.ylabel("MAE (cycles)")
        plt.title("Option A: Test MAE by target")
        plt.tight_layout()
        plt.savefig(out_dir / "mae_by_target_test.png", dpi=180)
        plt.close()

    # Production predictions overview (test only)
    test_all = preds[preds["split"] == "test"].copy()
    if not test_all.empty:
        test_all["abs_err"] = (test_all["y_pred"] - test_all["y_true"]).abs()
        plt.figure(figsize=(8, 6))
        sns.scatterplot(
            data=test_all,
            x="y_true",
            y="y_pred",
            hue="target",
            style="family",
            s=70,
            alpha=0.85,
        )
        lo = float(min(test_all["y_true"].min(), test_all["y_pred"].min()))
        hi = float(max(test_all["y_true"].max(), test_all["y_pred"].max()))
        pad = 0.05 * (hi - lo) if hi > lo else 1.0
        lo -= pad
        hi += pad
        plt.plot([lo, hi], [lo, hi], color="black", linewidth=1)
        plt.xlim(lo, hi)
        plt.ylim(lo, hi)
        plt.xlabel("True N")
        plt.ylabel("Predicted N")
        plt.title("Production Predictions (Test): All Targets")
        plt.legend(bbox_to_anchor=(1.02, 1), loc="upper left", borderaxespad=0)
        plt.tight_layout()
        plt.savefig(out_dir / "predictions_test_overview.png", dpi=170)
        plt.close()

        # Residual boxplot by target
        test_all["residual"] = test_all["y_pred"] - test_all["y_true"]
        plt.figure(figsize=(10, 5))
        sns.boxplot(data=test_all, x="target", y="residual", color="#9ecae9")
        plt.axhline(0.0, color="black", linewidth=1)
        plt.xticks(rotation=45, ha="right")
        plt.ylabel("Residual (Pred - True)")
        plt.title("Test Residuals by Target")
        plt.tight_layout()
        plt.savefig(out_dir / "residuals_by_target_test.png", dpi=180)
        plt.close()

    print(str(out_dir))


if __name__ == "__main__":
    main()
