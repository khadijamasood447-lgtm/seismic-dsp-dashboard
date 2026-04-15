from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import zipfile
from pathlib import Path
from typing import Any

import numpy as np


def _safe_float(s: str) -> float | None:
    try:
        v = float(s)
    except Exception:
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def parse_dat_table(text: str) -> tuple[list[str], list[list[float | None]]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return [], []

    header_idx = None
    for i in range(min(10, len(lines))):
        if re.search(r"[A-Za-z]", lines[i]) and re.search(r"\s", lines[i]):
            header_idx = i
            break
    if header_idx is None:
        return [], []

    header = re.split(r"\s+", lines[header_idx])
    data_start = header_idx + 1
    if data_start < len(lines) and re.search(r"\[.*?\]", lines[data_start]):
        data_start += 1

    rows: list[list[float | None]] = []
    for ln in lines[data_start:]:
        parts = re.split(r"\s+", ln)
        if len(parts) < 2:
            continue
        vals = [_safe_float(p) for p in parts]
        if len(vals) < len(header):
            vals = vals + [None] * (len(header) - len(vals))
        rows.append(vals[: len(header)])
    return header, rows


def find_columns(header: list[str]) -> dict[str, int]:
    idx: dict[str, int] = {}
    for i, col in enumerate(header):
        low = col.strip().lower()
        if low == "n" and "N" not in idx:
            idx["N"] = i
        if low in ("eps1av", "eps1", "epsa", "eps_a", "epsilon1", "epsilon") and "eps" not in idx:
            idx["eps"] = i
        if low.startswith("eps") and "eps" not in idx and "ampl" not in low:
            idx["eps"] = i
        if low in ("eps1ampl", "epsampl") and "eps_ampl" not in idx:
            idx["eps_ampl"] = i
        if low in ("qav", "q") and "q" not in idx:
            idx["q"] = i
        if low in ("pav", "p") and "p" not in idx:
            idx["p"] = i
        if low in ("uav", "u") and "u" not in idx:
            idx["u"] = i
        if low in ("sigma1", "sig1", "s1") and "sigma1" not in idx:
            idx["sigma1"] = i
        if low in ("sigma3", "sig3", "s3") and "sigma3" not in idx:
            idx["sigma3"] = i
        if low in ("time", "t", "time_s") and "time" not in idx:
            idx["time"] = i
    return idx


def first_non_null(rows: list[list[float | None]], i: int) -> float | None:
    for r in rows[:200]:
        v = r[i] if i < len(r) else None
        if v is not None:
            return float(v)
    return None


def robust_amplitude(values: list[float]) -> float | None:
    if len(values) < 50:
        return None
    arr = np.asarray(values, dtype=float)
    return float(np.percentile(arr, 95) - np.percentile(arr, 5)) / 2.0


def robust_amplitude_detrended(values: list[float]) -> float | None:
    if len(values) < 50:
        return None
    arr = np.asarray(values, dtype=float)
    med = float(np.median(arr))
    det = arr - med
    return float(np.percentile(np.abs(det), 95))


def median_first(values: list[float], n: int = 30) -> float | None:
    if not values:
        return None
    arr = np.asarray(values[:n], dtype=float)
    if arr.size == 0:
        return None
    return float(np.median(arr))


def extract_features_from_dat(zpath: Path, member: str) -> dict[str, Any]:
    with zipfile.ZipFile(zpath) as zf:
        raw = zf.read(member)
    header, rows = parse_dat_table(raw.decode("utf-8", "ignore"))
    col = find_columns(header)

    feat: dict[str, Any] = {
        "header_cols": len(header),
        "row_count": len(rows),
        "has_N": int("N" in col),
        "has_eps": int("eps" in col),
        "has_p": int("p" in col),
        "has_u": int("u" in col),
        "has_q": int("q" in col),
        "has_eps_ampl": int("eps_ampl" in col),
    }

    if "p" in col:
        feat["p0_kpa"] = first_non_null(rows, col["p"])
    if "u" in col:
        feat["u0_kpa"] = first_non_null(rows, col["u"])
    if "q" in col:
        feat["q0_kpa"] = first_non_null(rows, col["q"])
    if "eps" in col:
        feat["eps0_pct"] = first_non_null(rows, col["eps"])

    if "eps_ampl" in col:
        feat["eps_ampl0"] = first_non_null(rows, col["eps_ampl"])

    eps_ampl_med = None
    if "eps_ampl" in col:
        vals = [r[col["eps_ampl"]] for r in rows if r[col["eps_ampl"]] is not None]
        eps_ampl_med = median_first([float(v) for v in vals], n=30)
    feat["eps_ampl_med_first30"] = eps_ampl_med

    q_amp = None
    q_amp_source = None
    if "time" in col:
        if "q" in col:
            q_vals = [r[col["q"]] for r in rows[:20000] if r[col["q"]] is not None]
            q_amp = robust_amplitude_detrended([float(v) for v in q_vals])
            if q_amp is not None:
                q_amp_source = "detrended_q_time"
        if q_amp is None and "sigma1" in col and "sigma3" in col:
            s1_i = col["sigma1"]
            s3_i = col["sigma3"]
            q_vals = []
            for r in rows[:20000]:
                s1 = r[s1_i]
                s3 = r[s3_i]
                if s1 is None or s3 is None:
                    continue
                q_vals.append(float(s1 - s3))
            q_amp = robust_amplitude_detrended(q_vals)
            if q_amp is not None:
                q_amp_source = "detrended_sigma1_minus_sigma3_time"

    feat["q_ampl_est_kpa"] = q_amp
    feat["q_ampl_source"] = q_amp_source or ""

    csr_est = None
    csr_source = ""
    p0 = feat.get("p0_kpa")
    if p0 not in (None, "") and q_amp not in (None, ""):
        try:
            csr_est = (float(q_amp) / 2.0) / float(p0)
            csr_source = "estimated_from_time"
        except Exception:
            csr_est = None
            csr_source = ""

    feat["csr_est"] = csr_est
    feat["csr_source"] = csr_source

    return feat


def load_table6_tcui(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    out: dict[str, dict[str, Any]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            tid = row.get("test")
            if not tid:
                continue
            out[tid.upper()] = row
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ds_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    out_dir = ds_dir

    tests = list(csv.DictReader((ds_dir / "tests.csv").open(newline="", encoding="utf-8")))
    source_folder = root / "cyclic triaxial"

    table6 = load_table6_tcui(root / "pdf_extracted" / "ag_tables" / "2016-AG-part1__table6_TCUI.csv")

    rows: list[dict[str, Any]] = []
    for t in tests:
        test_id = t["test_id"]
        zip_name = t.get("feature_zip", "")
        member = t.get("feature_member", "")
        family = t["family"]
        split = t["split"]

        base = {
            "test_id": test_id,
            "family": family,
            "split": split,
            "feature_series_type": t.get("feature_series_type", ""),
            "feature_zip": zip_name,
            "feature_member": member,
            "target_series_type": t.get("target_series_type", ""),
            "target_zip": t.get("target_zip", ""),
            "target_member": t.get("target_member", ""),
        }

        if zip_name and member:
            feat = extract_features_from_dat(source_folder / zip_name, member)
            base.update(feat)
        else:
            base.update({"header_cols": "", "row_count": ""})

        if test_id in table6:
            r = table6[test_id]
            for k in ("e0", "ID0", "p0_kpa", "qampl_kpa", "qampl_over_p0"):
                if k in r and r[k] not in (None, ""):
                    base[f"t6_{k}"] = r[k]
            if "qampl_over_p0" in r and r["qampl_over_p0"] not in (None, ""):
                base["csr_est"] = r["qampl_over_p0"]
                base["csr_source"] = "table6_qampl_over_p0"
        rows.append(base)

    fieldnames = sorted({k for r in rows for k in r.keys()})
    out_path = out_dir / "features_option_a.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})

    report = {
        "dataset_dir": str(ds_dir),
        "features_path": str(out_path),
        "test_count": len(rows),
        "with_table6": sum(1 for r in rows if any(k.startswith("t6_") for k in r.keys())),
    }
    (out_dir / "features_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
