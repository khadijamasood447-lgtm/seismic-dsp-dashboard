from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


TEST_ID_RX = re.compile(r"^(TCUI\d+|TCUA\d+|TCUE\d+|TMCU\d+|TMCD\d+)", re.IGNORECASE)
VS_N_RX = re.compile(r"vs[-_ ]?n", re.IGNORECASE)
VS_TIME_RX = re.compile(r"vs[-_ ]?time", re.IGNORECASE)


def split_by_family(test_ids: list[str]) -> dict[str, str]:
    by_family: dict[str, list[str]] = {}
    for tid in test_ids:
        family = re.match(r"^[A-Z]+", tid).group(0)
        by_family.setdefault(family, []).append(tid)

    split_map: dict[str, str] = {}
    for family, ids in sorted(by_family.items()):
        ids_sorted = sorted(ids, key=lambda t: hashlib.sha256(t.encode("utf-8")).hexdigest())
        n = len(ids_sorted)
        n_train = int(round(n * 0.70))
        n_val = int(round(n * 0.15))
        n_test = n - n_train - n_val

        # Ensure representation where possible
        if n >= 5:
            n_val = max(1, n_val)
            n_test = max(1, n_test)
            n_train = n - n_val - n_test
        else:
            n_val = 0
            n_test = 0
            n_train = n

        train_ids = ids_sorted[:n_train]
        val_ids = ids_sorted[n_train : n_train + n_val]
        test_ids_f = ids_sorted[n_train + n_val :]

        for t in train_ids:
            split_map[t] = "train"
        for t in val_ids:
            split_map[t] = "val"
        for t in test_ids_f:
            split_map[t] = "test"

    return split_map


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
        key = col.strip()
        low = key.lower()
        if low == "n" and "N" not in idx:
            idx["N"] = i
        if low.startswith("n") and "N" not in idx and low in ("n", "ncyc", "ncycle", "ncycles"):
            idx["N"] = i
        if low in ("eps1av", "eps1", "epsa", "eps_a", "epsilon1", "epsilon") and "eps" not in idx:
            idx["eps"] = i
        if low.startswith("eps1av") and "eps" not in idx:
            idx["eps"] = i
        if low.startswith("eps") and "eps" not in idx and "ampl" not in low:
            idx["eps"] = i
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


def estimate_cycles_from_time(rows: list[list[float | None]], col: dict[str, int]) -> list[int | None] | None:
    if "eps" not in col:
        return None

    q_i = col.get("q")
    if q_i is None and "sigma1" in col and "sigma3" in col:
        q_i = -1
        s1_i = col["sigma1"]
        s3_i = col["sigma3"]
    else:
        s1_i = None
        s3_i = None

    q_vals = []
    for r in rows:
        if q_i == -1:
            s1 = r[s1_i] if s1_i is not None else None
            s3 = r[s3_i] if s3_i is not None else None
            q = None if (s1 is None or s3 is None) else (s1 - s3)
        else:
            q = r[q_i] if q_i is not None else None
        if q is not None:
            q_vals.append(q)

    if len(q_vals) < 200:
        return None

    q_arr = np.asarray(q_vals, dtype=float)
    q_med = float(np.median(q_arr))
    q_det = q_arr - q_med
    amp = float(np.percentile(np.abs(q_det), 95))
    if amp <= 0:
        return None
    thr = 0.05 * amp

    half_cycles = 0
    prev_sign = 0
    n_by_row: list[int | None] = []

    for r in rows:
        if q_i == -1:
            s1 = r[s1_i] if s1_i is not None else None
            s3 = r[s3_i] if s3_i is not None else None
            q = None if (s1 is None or s3 is None) else (s1 - s3)
        else:
            q = r[q_i] if q_i is not None else None

        if q is None:
            n_by_row.append(None)
            continue

        qd = q - q_med
        if abs(qd) < thr:
            sign = 0
        else:
            sign = 1 if qd > 0 else -1

        if prev_sign != 0 and sign != 0 and sign != prev_sign:
            half_cycles += 1
        if sign != 0:
            prev_sign = sign

        n_by_row.append((half_cycles // 2) + 1)

    return n_by_row


@dataclass(frozen=True)
class SeriesRef:
    test_id: str
    family: str
    zip_name: str
    member_path: str
    series_type: str
    file_size: int
    crc32: int


def build_series_index(folder: Path) -> tuple[list[SeriesRef], dict[str, list[SeriesRef]]]:
    zip_files = sorted(folder.glob("*.zip"))
    series: list[SeriesRef] = []
    by_test: dict[str, list[SeriesRef]] = {}

    for zpath in zip_files:
        with zipfile.ZipFile(zpath) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if not info.filename.lower().endswith(".dat"):
                    continue
                base = Path(info.filename).name
                m = TEST_ID_RX.match(base)
                if not m:
                    continue
                test_id = m.group(1).upper()
                family = re.match(r"^[A-Z]+", test_id).group(0)
                series_type = "other"
                if VS_N_RX.search(base):
                    series_type = "vs_N"
                elif VS_TIME_RX.search(base):
                    series_type = "vs_time"
                ref = SeriesRef(
                    test_id=test_id,
                    family=family,
                    zip_name=zpath.name,
                    member_path=info.filename,
                    series_type=series_type,
                    file_size=info.file_size,
                    crc32=info.CRC,
                )
                series.append(ref)
                by_test.setdefault(test_id, []).append(ref)

    return series, by_test


def choose_eps_source(series_list: list[SeriesRef]) -> SeriesRef | None:
    vsn = [s for s in series_list if s.series_type == "vs_N"]
    vst = [s for s in series_list if s.series_type == "vs_time"]
    other = [s for s in series_list if s.series_type == "other"]

    def pick_best(cands: list[SeriesRef]) -> SeriesRef | None:
        if not cands:
            return None
        cands_sorted = sorted(cands, key=lambda s: ("test-data" not in s.member_path.lower(), s.file_size), reverse=False)
        return cands_sorted[0]

    return pick_best(vsn) or pick_best(vst) or pick_best(other)


def choose_target_series(series_list: list[SeriesRef]) -> SeriesRef | None:
    vsn = [s for s in series_list if s.series_type == "vs_N"]
    vst = [s for s in series_list if s.series_type == "vs_time"]
    other = [s for s in series_list if s.series_type == "other"]

    def pick_best(cands: list[SeriesRef]) -> SeriesRef | None:
        if not cands:
            return None
        # Prefer smaller file if duplicated variants exist
        return sorted(cands, key=lambda s: ("test-data" not in s.member_path.lower(), s.file_size))[0]

    return pick_best(vsn) or pick_best(vst) or pick_best(other)


def choose_feature_series(series_list: list[SeriesRef]) -> SeriesRef | None:
    vst = [s for s in series_list if s.series_type == "vs_time"]
    vsn = [s for s in series_list if s.series_type == "vs_N"]
    other = [s for s in series_list if s.series_type == "other"]

    def pick_best(cands: list[SeriesRef]) -> SeriesRef | None:
        if not cands:
            return None
        return sorted(cands, key=lambda s: ("test-data" not in s.member_path.lower(), s.file_size))[0]

    return pick_best(vst) or pick_best(vsn) or pick_best(other)


def compute_thresholds_from_series(zpath: Path, member: str, thresholds_pct: list[float]) -> dict[str, Any]:
    with zipfile.ZipFile(zpath) as zf:
        raw = zf.read(member)

    header, rows = parse_dat_table(raw.decode("utf-8", "ignore"))
    col = find_columns(header)

    out: dict[str, Any] = {
        "source_member": member,
        "has_N": "N" in col,
        "has_eps": "eps" in col,
        "thresholds": {},
        "row_count": len(rows),
        "header": header,
        "eps_max_pct": None,
        "N_max": None,
        "N_source": "file" if "N" in col else None,
    }

    n_est: list[int | None] | None = None
    if "N" not in col and "eps" in col:
        n_est = estimate_cycles_from_time(rows, col)
        if n_est is not None:
            out["has_N"] = True
            out["N_source"] = "estimated_from_time"

    if ("N" not in col and n_est is None) or "eps" not in col:
        for t in thresholds_pct:
            out["thresholds"][str(t)] = None
        return out

    n_i = col.get("N")
    e_i = col["eps"]

    best: dict[float, float | None] = {t: None for t in thresholds_pct}
    eps_max = None
    n_max = None
    for i, r in enumerate(rows):
        if n_i is not None:
            n = r[n_i]
        else:
            n = None if n_est is None else n_est[i]

        e = r[e_i]
        if n is None or e is None:
            continue
        eabs = abs(e)
        eps_max = eabs if eps_max is None else max(eps_max, eabs)
        n_max = float(n) if n_max is None else max(n_max, float(n))
        for t in thresholds_pct:
            if best[t] is None and eabs >= t:
                best[t] = float(n)
    out["thresholds"] = {str(k): v for k, v in best.items()}
    out["eps_max_pct"] = eps_max
    out["N_max"] = n_max
    return out


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in fieldnames})


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    source_folder = root / "cyclic triaxial"
    out_dir = root / "data" / "training" / "cyclic_triaxial_v4"
    out_dir.mkdir(parents=True, exist_ok=True)

    thresholds_pct = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0]

    series, by_test = build_series_index(source_folder)
    split_map = split_by_family(list(by_test.keys()))

    seen_files = set()
    series_rows: list[dict[str, Any]] = []
    for s in series:
        file_key = (s.crc32, s.file_size)
        dup = file_key in seen_files
        seen_files.add(file_key)
        series_rows.append(
            {
                "test_id": s.test_id,
                "family": s.family,
                "zip": s.zip_name,
                "member": s.member_path,
                "series_type": s.series_type,
                "file_size": s.file_size,
                "crc32": s.crc32,
                "is_duplicate_by_crc_size": int(dup),
            }
        )

    tests_rows: list[dict[str, Any]] = []
    targets_rows: list[dict[str, Any]] = []
    qc: list[dict[str, Any]] = []

    for test_id, refs in sorted(by_test.items()):
        family = re.match(r"^[A-Z]+", test_id).group(0)
        split = split_map.get(test_id, "train")
        target_ref = choose_target_series(refs)
        feature_ref = choose_feature_series(refs)
        tests_rows.append(
            {
                "test_id": test_id,
                "family": family,
                "split": split,
                "source": "cyclic triaxial zips",
                "target_series_type": target_ref.series_type if target_ref else "",
                "target_zip": target_ref.zip_name if target_ref else "",
                "target_member": target_ref.member_path if target_ref else "",
                "feature_series_type": feature_ref.series_type if feature_ref else "",
                "feature_zip": feature_ref.zip_name if feature_ref else "",
                "feature_member": feature_ref.member_path if feature_ref else "",
            }
        )
        if target_ref is None:
            targets_rows.append(
                {
                    "test_id": test_id,
                    "family": family,
                    "split": split,
                    **{f"N_eps_{str(t).replace('.', '_')}": "" for t in thresholds_pct},
                    "eps_max_pct": "",
                    "N_max": "",
                }
            )
            qc.append({"test_id": test_id, "issue": "no_series_found"})
            continue

        info = compute_thresholds_from_series(source_folder / target_ref.zip_name, target_ref.member_path, thresholds_pct)
        threshold_values = info["thresholds"]

        targets_rows.append(
            {
                "test_id": test_id,
                "family": family,
                "split": split,
                **{
                    f"N_eps_{str(t).replace('.', '_')}": "" if threshold_values.get(str(t)) is None else int(threshold_values[str(t)])
                    for t in thresholds_pct
                },
                "eps_max_pct": "" if info.get("eps_max_pct") is None else float(info["eps_max_pct"]),
                "N_max": "" if info.get("N_max") is None else int(info["N_max"]),
            }
        )

        if not info.get("has_N"):
            qc.append({"test_id": test_id, "issue": "missing_N_column", "series": target_ref.member_path})
        if not info.get("has_eps"):
            qc.append({"test_id": test_id, "issue": "missing_eps_column", "series": target_ref.member_path})
        if info.get("has_N") and info.get("has_eps"):
            if all(threshold_values.get(str(t)) is None for t in thresholds_pct):
                qc.append({"test_id": test_id, "issue": "no_threshold_reached", "series": target_ref.member_path})

    write_csv(
        out_dir / "series.csv",
        series_rows,
        [
            "test_id",
            "family",
            "zip",
            "member",
            "series_type",
            "file_size",
            "crc32",
            "is_duplicate_by_crc_size",
        ],
    )
    write_csv(
        out_dir / "tests.csv",
        tests_rows,
        [
            "test_id",
            "family",
            "split",
            "source",
            "target_series_type",
            "target_zip",
            "target_member",
            "feature_series_type",
            "feature_zip",
            "feature_member",
        ],
    )
    write_csv(
        out_dir / "targets_option_a.csv",
        targets_rows,
        [
            "test_id",
            "family",
            "split",
            *[f"N_eps_{str(t).replace('.', '_')}" for t in thresholds_pct],
            "eps_max_pct",
            "N_max",
        ],
    )

    report = {
        "source_folder": str(source_folder),
        "out_dir": str(out_dir),
        "test_count": len(tests_rows),
        "series_count": len(series_rows),
        "thresholds_pct": thresholds_pct,
        "split_counts": {
            "train": sum(1 for r in tests_rows if r["split"] == "train"),
            "val": sum(1 for r in tests_rows if r["split"] == "val"),
            "test": sum(1 for r in tests_rows if r["split"] == "test"),
        },
        "qc_issues": qc,
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    splits = {
        "train": [r["test_id"] for r in tests_rows if r["split"] == "train"],
        "val": [r["test_id"] for r in tests_rows if r["split"] == "val"],
        "test": [r["test_id"] for r in tests_rows if r["split"] == "test"],
    }
    (out_dir / "splits.json").write_text(json.dumps(splits, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_dir))


if __name__ == "__main__":
    main()
