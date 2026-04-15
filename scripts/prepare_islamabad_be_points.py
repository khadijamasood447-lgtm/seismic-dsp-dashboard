from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


def _read_any(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    return pd.read_csv(path)


def _to_float(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="Input CSV/XLSX with site + lat/lon")
    ap.add_argument("--out", required=True, help="Output CSV path")
    ap.add_argument("--site-col", default="Site")
    ap.add_argument("--lat-col", default=None, help="Latitude column name (auto-detect if omitted)")
    ap.add_argument("--lon-col", default=None, help="Longitude column name (auto-detect if omitted)")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    in_path = (root / args.inp).resolve()
    out_path = (root / args.out).resolve()

    df = _read_any(in_path)

    df = df.rename(columns={c: str(c).strip() for c in df.columns})

    site_col = str(args.site_col).strip()
    if site_col not in df.columns:
        raise SystemExit(f"Missing site column '{args.site_col}'. Found: {list(df.columns)}")

    cols = list(df.columns)
    lat_col = str(args.lat_col).strip() if args.lat_col is not None else None
    lon_col = str(args.lon_col).strip() if args.lon_col is not None else None

    if lat_col is None or lon_col is None:
        lat_candidates = [c for c in cols if "lat" in str(c).lower() or str(c).strip().lower() in {"y"}]
        lon_candidates = [c for c in cols if "lon" in str(c).lower() or "lng" in str(c).lower() or str(c).strip().lower() in {"x"}]

        if lat_col is None:
            lat_col = lat_candidates[0] if lat_candidates else None
        if lon_col is None:
            lon_col = lon_candidates[0] if lon_candidates else None

    if lat_col is None or lon_col is None:
        raise SystemExit(
            "Could not auto-detect lat/lon columns. Pass --lat-col and --lon-col explicitly. "
            f"Found columns: {cols}"
        )

    out_df = pd.DataFrame({"site_id": df[site_col].astype(str).str.strip()})

    lat_s = _to_float(df[lat_col])
    lon_s = _to_float(df[lon_col])

    if lon_s.isna().all() and lat_s.notna().any():
        guess_lon = lat_s.copy()
        guess_lat = lon_s.copy()
        lon_s = guess_lon
        lat_s = guess_lat

    out_df["lat"] = lat_s
    out_df["lon"] = lon_s

    out_df = out_df.dropna(subset=["lat", "lon"]).drop_duplicates(subset=["site_id", "lat", "lon"], keep="first")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out_path, index=False)
    print(str(out_path))


if __name__ == "__main__":
    main()
