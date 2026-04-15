from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    feats = pd.read_csv(ds_dir / "features_option_a.csv")
    targets = pd.read_csv(ds_dir / "targets_option_a.csv")

    df = feats.merge(targets[["test_id", "split"]], on="test_id", how="left")

    csr_counts = df["csr_source"].fillna("").value_counts().to_dict() if "csr_source" in df.columns else {}
    q_amp_counts = df["q_ampl_source"].fillna("").value_counts().to_dict() if "q_ampl_source" in df.columns else {}

    report = {
        "dataset": str(ds_dir),
        "test_count": int(len(df)),
        "csr_est_nonnull": int(df["csr_est"].notna().sum()) if "csr_est" in df.columns else 0,
        "csr_source_counts": csr_counts,
        "q_ampl_est_nonnull": int(df["q_ampl_est_kpa"].notna().sum()) if "q_ampl_est_kpa" in df.columns else 0,
        "q_ampl_source_counts": q_amp_counts,
        "notes": {
            "csr_source_meaning": {
                "table6_qampl_over_p0": "CSR proxy taken directly from Acta Geotech 2016 Table 6 (qampl/p0).",
                "estimated_from_time": "CSR proxy estimated from vs-time series as (q_ampl/2)/p0.",
                "": "CSR proxy not available for this test yet."
            },
            "q_ampl_source_meaning": {
                "detrended_q_time": "q amplitude estimated from time-series q using robust detrended amplitude.",
                "detrended_sigma1_minus_sigma3_time": "q amplitude estimated from sigma1-sigma3 time series.",
                "": "No q amplitude estimate available (e.g., vs-N file only)."
            }
        }
    }

    out_path = ds_dir / "provenance_report.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
