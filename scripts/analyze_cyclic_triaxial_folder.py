from __future__ import annotations

import json
import re
import zipfile
from collections import Counter
from pathlib import Path


def count_dat_points_from_text(text: str) -> int:
    n = 0
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        n += 1
    return n


def count_gds_points_from_text(text: str) -> int:
    lines = text.splitlines()
    header = None
    for i, line in enumerate(lines):
        if '"Stage Number"' in line:
            header = i
            break
    if header is None:
        return 0
    return max(0, len(lines) - (header + 1))


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    folder = root / "cyclic triaxial"

    file_paths = [p for p in folder.rglob("*") if p.is_file()]
    ext_counts = Counter(p.suffix.lower() for p in file_paths)

    dat_files = [p for p in file_paths if p.suffix.lower() == ".dat"]
    gds_files = [p for p in file_paths if p.suffix.lower() == ".gds"]
    csv_files = [p for p in file_paths if p.suffix.lower() == ".csv"]
    xlsx_files = [p for p in file_paths if p.suffix.lower() == ".xlsx"]
    zip_files = [p for p in file_paths if p.suffix.lower() == ".zip"]

    dat_points = sum(count_dat_points_from_text(p.read_text(errors="ignore")) for p in dat_files)
    gds_points = sum(count_gds_points_from_text(p.read_text(errors="ignore")) for p in gds_files)

    zip_member_total = 0
    zip_member_ext_counts: Counter[str] = Counter()
    zip_dat_members: list[tuple[str, str, int]] = []
    zip_member_names: list[str] = []
    zip_breakdown = []

    for z in zip_files:
        with zipfile.ZipFile(z) as zf:
            exts: Counter[str] = Counter()
            members = 0
            for info in zf.infolist():
                if info.is_dir():
                    continue
                members += 1
                name = info.filename.replace("\\", "/")
                zip_member_names.append(name)
                ext = Path(name).suffix.lower()
                exts[ext] += 1
                zip_member_ext_counts[ext] += 1
                zip_member_total += 1
                if ext == ".dat":
                    zip_dat_members.append((z.name, name, info.file_size))
            zip_breakdown.append({"zip": z.name, "members": members, "exts": dict(exts)})

    dup_member_counts = Counter(zip_member_names)
    dup_members = {k: v for k, v in dup_member_counts.items() if v > 1}

    prefix_rx = re.compile(r"^(TCUI|TCUA|TCUE|TMCU|TMCD|ISO|OEC)[-_ ]?", re.IGNORECASE)
    dat_prefix_counts = Counter()
    dat_basenames = Counter(Path(n).name for _, n, _ in zip_dat_members)
    for base in dat_basenames:
        m = prefix_rx.match(base)
        dat_prefix_counts[(m.group(1).upper() if m else "OTHER")] += 1

    # sample a few .dat members to see the header style
    sample_headers = []
    for zname, member, _ in zip_dat_members[:8]:
        with zipfile.ZipFile(folder / zname) as zf:
            with zf.open(member) as f:
                head = f.read(4000).decode("utf-8", "ignore")
        lines = [ln.strip() for ln in head.splitlines() if ln.strip()][:8]
        sample_headers.append({"zip": zname, "member": member, "lines": lines})

    payload = {
        "folder": str(folder.name),
        "file_count": len(file_paths),
        "extension_counts": dict(ext_counts),
        "dat": {"files": len(dat_files), "points": dat_points},
        "gds": {"files": len(gds_files), "points": gds_points},
        "csv": {"files": len(csv_files)},
        "xlsx": {"files": len(xlsx_files)},
        "zip": {
            "files": len(zip_files),
            "member_files_total": zip_member_total,
            "member_extension_counts": dict(zip_member_ext_counts),
            "duplicate_member_files": len(dup_members),
            "dat_members": len(zip_dat_members),
            "dat_prefix_counts": dict(dat_prefix_counts),
            "breakdown": zip_breakdown,
            "sample_headers": sample_headers,
        },
    }

    out_path = root / "cyclic_triaxial_inventory.json"
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()

