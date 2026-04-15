from __future__ import annotations

import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path


TEST_ID_RX = re.compile(r"^(TCUI\d+|TCUA\d+|TCUE\d+|TMCU\d+|TMCD\d+|ISO\d+|OEC\d+)", re.IGNORECASE)


def count_data_lines(text: str) -> int:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return 0
    # drop first 2 header lines if they are non-numeric
    drop = 0
    for i in range(min(3, len(lines))):
        if re.search(r"[a-zA-Z]", lines[i]):
            drop += 1
        else:
            break
    return max(0, len(lines) - drop)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    folder = root / "cyclic triaxial"
    zips = sorted(folder.glob("*.zip"))

    test_files: dict[str, list[tuple[str, str]]] = defaultdict(list)
    total_dat_files = 0
    total_dat_points = 0
    per_prefix_tests: Counter[str] = Counter()
    per_prefix_files: Counter[str] = Counter()
    per_prefix_points: Counter[str] = Counter()

    for z in zips:
        with zipfile.ZipFile(z) as zf:
            dats = [n for n in zf.namelist() if n.lower().endswith('.dat')]
            for name in dats:
                base = Path(name).name
                m = TEST_ID_RX.match(base)
                if not m:
                    continue
                test_id = m.group(1).upper()
                prefix = re.match(r"^[A-Z]+", test_id).group(0)
                total_dat_files += 1
                per_prefix_files[prefix] += 1
                test_files[test_id].append((z.name, name))

                # count points (cheap: read bytes and count lines)
                with zf.open(name) as f:
                    head = f.read().decode('utf-8', 'ignore')
                pts = count_data_lines(head)
                total_dat_points += pts
                per_prefix_points[prefix] += pts

    for test_id in test_files:
        prefix = re.match(r"^[A-Z]+", test_id).group(0)
        per_prefix_tests[prefix] += 1

    print(f"zip_dat_files_used={total_dat_files}")
    print(f"zip_dat_points_est={total_dat_points}")
    print("\nUnique tests by prefix:")
    for p, n in per_prefix_tests.most_common():
        print(f"  {p}: tests={n} files={per_prefix_files[p]} points_est={per_prefix_points[p]}")

    # show coverage per test (how many files per test)
    filecount_dist = Counter(len(v) for v in test_files.values())
    print("\nFiles-per-test distribution:")
    for k in sorted(filecount_dist):
        print(f"  {k} files: {filecount_dist[k]} tests")


if __name__ == "__main__":
    main()

