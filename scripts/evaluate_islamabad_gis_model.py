from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import LeaveOneOut


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float | None]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    ok = np.isfinite(y_true) & np.isfinite(y_pred)
    y_true = y_true[ok]
    y_pred = y_pred[ok]
    if y_true.size == 0:
        return {"mae": None, "rmse": None, "r2": None}
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred)) if y_true.size >= 3 else None
    return {"mae": mae, "rmse": rmse, "r2": r2}


def plot_scatter(out_path: Path, y_true: np.ndarray, y_pred: np.ndarray, title: str) -> None:
    import matplotlib.pyplot as plt

    fig = plt.figure(figsize=(5, 5), dpi=160)
    ax = fig.add_subplot(1, 1, 1)
    ax.scatter(y_true, y_pred, s=28, alpha=0.9)
    mn = float(np.nanmin([np.nanmin(y_true), np.nanmin(y_pred)]))
    mx = float(np.nanmax([np.nanmax(y_true), np.nanmax(y_pred)]))
    ax.plot([mn, mx], [mn, mx], linestyle="--", linewidth=1)
    ax.set_title(title)
    ax.set_xlabel("true")
    ax.set_ylabel("pred")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def plot_residuals(out_path: Path, y_true: np.ndarray, y_pred: np.ndarray, title: str) -> None:
    import matplotlib.pyplot as plt

    resid = y_pred - y_true
    fig = plt.figure(figsize=(5, 3.5), dpi=160)
    ax = fig.add_subplot(1, 1, 1)
    ax.scatter(y_true, resid, s=28, alpha=0.9)
    ax.axhline(0, linestyle="--", linewidth=1)
    ax.set_title(title)
    ax.set_xlabel("true")
    ax.set_ylabel("pred - true")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(out_path)
    plt.close(fig)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True, help="Folder containing models/*.joblib and report.json")
    ap.add_argument("--dataset", required=True, help="CSV containing features and targets")
    ap.add_argument("--out-dir", required=True, help="Output folder")
    ap.add_argument("--id-col", default="site_id")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    model_dir = (root / args.model_dir).resolve()
    ds_path = (root / args.dataset).resolve()
    out_dir = (root / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    report = json.loads((model_dir / "report.json").read_text(encoding="utf-8"))
    feature_cols: list[str] = list(report.get("features", []))
    targets = [t for t, v in report.get("targets", {}).items() if not v.get("skipped")]

    df = pd.read_csv(ds_path)
    X = df[feature_cols].copy()

    import joblib  # type: ignore

    summary: dict[str, object] = {
        "dataset": str(ds_path),
        "model_dir": str(model_dir),
        "n_rows": int(len(df)),
        "targets": {},
    }

    all_preds_rows: list[dict[str, object]] = []

    for target in targets:
        y = pd.to_numeric(df[target], errors="coerce").to_numpy(dtype=float)
        ok = np.isfinite(y)
        if int(ok.sum()) < 3:
            continue

        X_ok = X.loc[ok].reset_index(drop=True)
        y_ok = y[ok]
        ids_ok = df.loc[ok, args.id_col].astype(str).tolist() if args.id_col in df.columns else [str(i) for i in range(len(y_ok))]

        model_path = model_dir / "models" / f"{target}.joblib"
        model = joblib.load(model_path)

        y_fit = model.predict(X_ok)

        loo = LeaveOneOut()
        y_cv = np.full_like(y_ok, np.nan, dtype=float)
        for train_idx, test_idx in loo.split(X_ok):
            model_i = joblib.load(model_path)
            model_i.fit(X_ok.iloc[train_idx], y_ok[train_idx])
            y_cv[test_idx[0]] = float(model_i.predict(X_ok.iloc[test_idx])[0])

        m_fit = metrics(y_ok, y_fit)
        m_cv = metrics(y_ok, y_cv)

        summary["targets"][target] = {
            "n": int(y_ok.size),
            "fit": m_fit,
            "loocv": m_cv,
        }

        for i in range(len(y_ok)):
            all_preds_rows.append(
                {
                    "target": target,
                    "id": ids_ok[i],
                    "y_true": float(y_ok[i]),
                    "y_pred_fit": float(y_fit[i]),
                    "y_pred_loocv": float(y_cv[i]) if np.isfinite(y_cv[i]) else None,
                    "abs_err_loocv": float(abs(y_ok[i] - y_cv[i])) if np.isfinite(y_cv[i]) else None,
                }
            )

        plot_scatter(out_dir / f"scatter_fit_{target}.png", y_ok, y_fit, f"{target}: fit")
        plot_scatter(out_dir / f"scatter_loocv_{target}.png", y_ok, y_cv, f"{target}: LOOCV")
        plot_residuals(out_dir / f"residuals_loocv_{target}.png", y_ok, y_cv, f"{target}: LOOCV residuals")

    pd.DataFrame(all_preds_rows).to_csv(out_dir / "predictions.csv", index=False)
    (out_dir / "metrics.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_dir))


if __name__ == "__main__":
    main()

