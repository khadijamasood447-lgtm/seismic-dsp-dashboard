from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    preds_path = ds_dir / "predictions_production_calibrated.csv"
    report_path = ds_dir / "production_report_calibrated.json"
    if not preds_path.exists() or not report_path.exists():
        raise SystemExit("Run scripts/train_option_a_production_calibrated.py first")

    out_dir = ds_dir / "plots"
    out_dir.mkdir(parents=True, exist_ok=True)

    preds = pd.read_csv(preds_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))

    sns.set_theme(style="whitegrid")

    # Metrics summary (test only)
    rows = []
    for tgt, info in report.get("targets", {}).items():
        if info.get("skipped"):
            continue
        m = info["metrics"]["test"]
        rows.append({"target": tgt, "mae": m["mae"], "rmse": m["rmse"], "r2": m["r2"], "selected": info.get("calibration", {}).get("selected")})
    if rows:
        dfm = pd.DataFrame(rows).sort_values("target")
        dfm.to_csv(out_dir / "test_metrics_summary_calibrated.csv", index=False)
        plt.figure(figsize=(11, 5))
        sns.barplot(data=dfm, x="target", y="r2", hue="selected")
        plt.axhline(0.0, color="black", linewidth=1)
        plt.xticks(rotation=45, ha="right")
        plt.ylabel("R² (test)")
        plt.title("Test R² by Target (Calibrated pipeline)")
        plt.tight_layout()
        plt.savefig(out_dir / "r2_by_target_test_calibrated.png", dpi=180)
        plt.close()

    # Test prediction overview
    test = preds[preds["split"] == "test"].copy()
    if not test.empty:
        plt.figure(figsize=(8, 6))
        sns.scatterplot(data=test, x="y_true", y="y_pred", hue="target", style="family", s=70, alpha=0.85)
        lo = float(min(test["y_true"].min(), test["y_pred"].min()))
        hi = float(max(test["y_true"].max(), test["y_pred"].max()))
        pad = 0.05 * (hi - lo) if hi > lo else 1.0
        lo -= pad
        hi += pad
        plt.plot([lo, hi], [lo, hi], color="black", linewidth=1)
        plt.xlim(lo, hi)
        plt.ylim(lo, hi)
        plt.xlabel("True N")
        plt.ylabel("Predicted N")
        plt.title("Calibrated Predictions (Test): All Targets")
        plt.legend(bbox_to_anchor=(1.02, 1), loc="upper left", borderaxespad=0)
        plt.tight_layout()
        plt.savefig(out_dir / "predictions_test_overview_calibrated.png", dpi=170)
        plt.close()

    print(str(out_dir))


if __name__ == "__main__":
    main()

