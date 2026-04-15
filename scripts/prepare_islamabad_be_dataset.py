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
    ap.add_argument("--in", dest="inp", required=True, help="Input CSV/XLSX with BE results")
    ap.add_argument("--out", required=True, help="Output cleaned CSV path")
    ap.add_argument("--site-col", default="Site")
    ap.add_argument("--lat-col", default="Coordinates")
    ap.add_argument("--lon-col", default="Unnamed: 2")
    ap.add_argument("--vs-col", default="S-wave( Vs)")
    ap.add_argument("--vp-col", default="P-wave (Vs)")
    ap.add_argument("--density-col", default="Density  (g/cm3)")
    ap.add_argument("--moisture-col", default="moisture content %")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    in_path = (root / args.inp).resolve()
    out_path = (root / args.out).resolve()

    df = _read_any(in_path)
    df = df.rename(columns={c: str(c).strip() for c in df.columns})

    def col(name: str) -> str:
        n = str(name).strip()
        if n not in df.columns:
            raise SystemExit(f"Missing column '{n}'. Found: {list(df.columns)}")
        return n

    site_col = col(args.site_col)
    lat_col = col(args.lat_col)
    lon_col = col(args.lon_col)
    vs_col = col(args.vs_col)
    vp_col = col(args.vp_col)
    density_col = col(args.density_col)
    moisture_col = col(args.moisture_col)

    site_id = df[site_col].astype(str).str.strip()
    lat = _to_float(df[lat_col])
    lon = _to_float(df[lon_col])

    if lon.isna().all() and lat.notna().any():
        lon, lat = lat.copy(), lon.copy()

    out_df = pd.DataFrame(
        {
            "site_id": site_id,
            "lon": lon,
            "lat": lat,
            "vs_sw": _to_float(df[vs_col]),
            "vp_pw": _to_float(df[vp_col]),
            "density_g_cm3": _to_float(df[density_col]),
            "moisture_pct": _to_float(df[moisture_col]),
        }
    )

    out_df = out_df.dropna(subset=["lon", "lat"]).drop_duplicates(subset=["site_id", "lon", "lat"], keep="first")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out_path, index=False)
    print(str(out_path))


if __name__ == "__main__":
    main()

