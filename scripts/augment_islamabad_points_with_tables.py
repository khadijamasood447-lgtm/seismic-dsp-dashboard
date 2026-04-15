from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd


def _read_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path)


def _to_float(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def _parse_sector(site_id: str) -> str | None:
    import re

    m = re.search(r"\b([A-Z]-\d{1,2})\b", str(site_id).upper())
    return m.group(1) if m else None


def _idw(lon: float, lat: float, pts: np.ndarray, vals: np.ndarray, k: int = 5, power: float = 2.0) -> float | None:
    if pts.size == 0:
        return None

    dx = pts[:, 0] - lon
    dy = pts[:, 1] - lat
    d2 = dx * dx + dy * dy
    order = np.argsort(d2)
    order = order[: min(k, order.size)]
    d2 = d2[order]
    vv = vals[order]

    if order.size == 0:
        return None
    if float(d2[0]) == 0.0:
        return float(vv[0]) if math.isfinite(float(vv[0])) else None

    w = 1.0 / (np.power(d2, power / 2.0) + 1e-12)
    ok = np.isfinite(vv) & np.isfinite(w)
    if not bool(ok.any()):
        return None
    w = w[ok]
    vv = vv[ok]
    w = w / float(w.sum())
    return float(np.sum(vv * w))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--points", required=True, help="Input points CSV containing lon/lat")
    ap.add_argument("--out", required=True, help="Output CSV with augmented table features")
    ap.add_argument("--lon-col", default="lon")
    ap.add_argument("--lat-col", default="lat")
    ap.add_argument("--site-col", default="site_id")
    ap.add_argument(
        "--pga",
        default="data/gis/islamabad_zone1/standardized/pga_islamabad.csv",
        help="PGA sector table (CSV)",
    )
    ap.add_argument(
        "--subbasins",
        default="data/gis/islamabad_zone1/standardized/subbasins_runoff.csv",
        help="Subbasin points table (CSV with lat/lon)",
    )
    ap.add_argument("--pga-return-period", default=500, type=int)
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    points_path = (root / args.points).resolve()
    out_path = (root / args.out).resolve()
    pga_path = (root / args.pga).resolve()
    sub_path = (root / args.subbasins).resolve()

    df = _read_csv(points_path)
    if args.lon_col not in df.columns or args.lat_col not in df.columns:
        raise SystemExit(f"Missing lon/lat columns '{args.lon_col}', '{args.lat_col}'")

    df[args.lon_col] = _to_float(df[args.lon_col])
    df[args.lat_col] = _to_float(df[args.lat_col])

    lon = df[args.lon_col].to_numpy(dtype=float)
    lat = df[args.lat_col].to_numpy(dtype=float)

    sub = pd.read_csv(sub_path)
    sub = sub.rename(columns={c: str(c).strip() for c in sub.columns})
    sub_pts = np.column_stack([
        _to_float(sub["Longitude"]).to_numpy(dtype=float),
        _to_float(sub["Latitude"]).to_numpy(dtype=float),
    ])
    runoff_class = _to_float(sub["Runoff_Class"]).to_numpy(dtype=float)

    def depth_mean(s: str) -> float | None:
        t = str(s).strip()
        if t == "":
            return None
        if "-" in t:
            a, b = t.split("-", 1)
            try:
                return (float(a) + float(b)) / 2.0
            except Exception:
                return None
        try:
            return float(t)
        except Exception:
            return None

    runoff_depth = sub["Runoff_Depth_mm"].map(depth_mean).astype(float).to_numpy(dtype=float)
    min_elev = _to_float(sub["Min_Elev_m"]).to_numpy(dtype=float)
    max_elev = _to_float(sub["Max_Elev_m"]).to_numpy(dtype=float)
    area_km2 = _to_float(sub["Area_km2"]).to_numpy(dtype=float)

    out_runoff_class: list[float | None] = []
    out_runoff_depth: list[float | None] = []
    out_min_elev: list[float | None] = []
    out_max_elev: list[float | None] = []
    out_area: list[float | None] = []

    for lo, la in zip(lon.tolist(), lat.tolist()):
        if not math.isfinite(lo) or not math.isfinite(la):
            out_runoff_class.append(None)
            out_runoff_depth.append(None)
            out_min_elev.append(None)
            out_max_elev.append(None)
            out_area.append(None)
            continue
        rc = _idw(lo, la, sub_pts, runoff_class)
        rd = _idw(lo, la, sub_pts, runoff_depth)
        mi = _idw(lo, la, sub_pts, min_elev)
        ma = _idw(lo, la, sub_pts, max_elev)
        ar = _idw(lo, la, sub_pts, area_km2)
        out_runoff_class.append(float(round(rc)) if rc is not None else None)
        out_runoff_depth.append(rd)
        out_min_elev.append(mi)
        out_max_elev.append(ma)
        out_area.append(ar)

    df["sub_runoff_class"] = out_runoff_class
    df["sub_runoff_depth_mm_mean"] = out_runoff_depth
    df["sub_min_elev_m"] = out_min_elev
    df["sub_max_elev_m"] = out_max_elev
    df["sub_area_km2"] = out_area

    pga_df = pd.read_csv(pga_path)
    pga_df = pga_df.rename(columns={c: str(c).strip() for c in pga_df.columns})
    pga_df = pga_df.loc[pga_df["Return_Period"].astype(int) == int(args.pga_return_period)].copy()
    pga_df["Sector"] = pga_df["Sector"].astype(str).str.strip().str.upper()
    pga_map = {
        r["Sector"]: {
            "pga_500": float(r["PGA_500"]) if pd.notna(r["PGA_500"]) else None,
            "pga_2500": float(r["PGA_2500"]) if pd.notna(r["PGA_2500"]) else None,
        }
        for _, r in pga_df.iterrows()
    }

    sectors: list[str | None] = []
    pga_500: list[float | None] = []
    pga_2500: list[float | None] = []

    if args.site_col in df.columns:
        for site in df[args.site_col].astype(str).tolist():
            sec = _parse_sector(site)
            sectors.append(sec)
            if sec and sec in pga_map:
                pga_500.append(pga_map[sec]["pga_500"])
                pga_2500.append(pga_map[sec]["pga_2500"])
            else:
                pga_500.append(None)
                pga_2500.append(None)
    else:
        sectors = [None] * len(df)
        pga_500 = [None] * len(df)
        pga_2500 = [None] * len(df)

    df["sector"] = sectors
    df["pga_500"] = pga_500
    df["pga_2500"] = pga_2500

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    print(str(out_path))


if __name__ == "__main__":
    main()

