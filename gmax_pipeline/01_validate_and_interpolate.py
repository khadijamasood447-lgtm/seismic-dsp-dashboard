from __future__ import annotations

import argparse
import json
import math
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import fiona
import numpy as np
import pandas as pd
import rasterio
from pyproj import CRS, Transformer
from rasterio.transform import rowcol, xy
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform, unary_union
from sklearn.neighbors import KDTree


REPO_ROOT = Path(__file__).resolve().parents[1]


def _now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_rmtree(path: Path) -> None:
  if not path.exists():
    return
  if path.is_dir():
    shutil.rmtree(path)
    return
  path.unlink()


def _clean_outputs(outputs_dir: Path) -> None:
  for sub in ("models", "metrics", "predictions"):
    _safe_rmtree(outputs_dir / sub)


def _read_bender_points(csv_path: Path) -> pd.DataFrame:
  raw = pd.read_csv(csv_path, header=None)

  sector = raw.iloc[:, 0].astype(str)
  lat = pd.to_numeric(raw.iloc[:, 1], errors="coerce")
  lon = pd.to_numeric(raw.iloc[:, 2], errors="coerce")
  mask = lat.notna() & lon.notna() & sector.str.strip().ne("")

  df = raw.loc[mask].copy().reset_index(drop=True)
  out = pd.DataFrame(
    {
      "sector": df.iloc[:, 0].astype(str),
      "lat": pd.to_numeric(df.iloc[:, 1], errors="coerce"),
      "lon": pd.to_numeric(df.iloc[:, 2], errors="coerce"),
      "pct_gravel": pd.to_numeric(df.iloc[:, 3], errors="coerce"),
      "pct_sand": pd.to_numeric(df.iloc[:, 4], errors="coerce"),
      "pct_fines": pd.to_numeric(df.iloc[:, 5], errors="coerce"),
      "cu": pd.to_numeric(df.iloc[:, 6], errors="coerce"),
      "cc": pd.to_numeric(df.iloc[:, 7], errors="coerce"),
      "soil_class": df.iloc[:, 8].astype(str),
      "specific_gravity": pd.to_numeric(df.iloc[:, 9], errors="coerce"),
      "moisture_content": pd.to_numeric(df.iloc[:, 10], errors="coerce"),
      "insitu_density": pd.to_numeric(df.iloc[:, 11], errors="coerce"),
      "ll": pd.to_numeric(df.iloc[:, 12], errors="coerce"),
      "pl": pd.to_numeric(df.iloc[:, 13], errors="coerce"),
      "pi": pd.to_numeric(df.iloc[:, 14], errors="coerce"),
      "p_to_p": pd.to_numeric(df.iloc[:, 15], errors="coerce"),
      "gmax_mpa": pd.to_numeric(df.iloc[:, 16], errors="coerce"),
    }
  )

  out = out.dropna(subset=["lat", "lon"]).reset_index(drop=True)
  out = out[(out["lat"].between(-90, 90)) & (out["lon"].between(-180, 180))].reset_index(drop=True)
  return out


def _read_vs30_points(xlsx_path: Path) -> pd.DataFrame:
  raw = pd.read_excel(xlsx_path, header=None)
  header_row = None
  for i in range(min(60, len(raw))):
    row = raw.iloc[i].astype(str).str.lower().tolist()
    if any("longitude" in c for c in row) and any("latitude" in c for c in row) and any("vs30" in c for c in row):
      header_row = i
      break
  if header_row is None:
    raise RuntimeError("Could not locate VS30 header row in XLSX")

  df = pd.read_excel(xlsx_path, header=header_row)
  cols = {str(c).lower().strip(): c for c in df.columns}

  lon_col = next((v for k, v in cols.items() if "longitude" in k), None)
  lat_col = next((v for k, v in cols.items() if "latitude" in k), None)
  vs_col = next((v for k, v in cols.items() if "vs30" in k), None)
  if lon_col is None or lat_col is None or vs_col is None:
    raise RuntimeError("VS30 XLSX missing Longitude/Latitude/VS30 columns")

  out = pd.DataFrame(
    {
      "lon": pd.to_numeric(df[lon_col], errors="coerce"),
      "lat": pd.to_numeric(df[lat_col], errors="coerce"),
      "vs30_m_s": pd.to_numeric(df[vs_col], errors="coerce"),
    }
  )
  out = out.dropna(subset=["lon", "lat"]).reset_index(drop=True)
  out = out[(out["lat"].between(-90, 90)) & (out["lon"].between(-180, 180))].reset_index(drop=True)
  return out


def _aoi_rectangle_wgs84(points: pd.DataFrame, buffer_m: float) -> Tuple[Any, Dict[str, Any]]:
  tx_to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  tx_to_wgs = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True)
  xs, ys = tx_to_utm.transform(points["lon"].to_numpy(dtype=float), points["lat"].to_numpy(dtype=float))
  minx = float(np.min(xs) - buffer_m)
  maxx = float(np.max(xs) + buffer_m)
  miny = float(np.min(ys) - buffer_m)
  maxy = float(np.max(ys) + buffer_m)
  aoi_utm = box(minx, miny, maxx, maxy)
  aoi_wgs = transform(tx_to_wgs.transform, aoi_utm)
  meta = {
    "buffer_m": float(buffer_m),
    "bbox_utm": {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy},
    "bbox_wgs84": {
      "min_lon": float(aoi_wgs.bounds[0]),
      "min_lat": float(aoi_wgs.bounds[1]),
      "max_lon": float(aoi_wgs.bounds[2]),
      "max_lat": float(aoi_wgs.bounds[3]),
    },
  }
  return aoi_wgs, meta


def _grid_from_template(template_path: Path, aoi_wgs84: Any) -> pd.DataFrame:
  with rasterio.open(template_path) as ds:
    if ds.crs is None:
      raise RuntimeError(f"Template raster has no CRS: {template_path}")

    to_template = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
    to_wgs = Transformer.from_crs(ds.crs, "EPSG:4326", always_xy=True)

    aoi_in_template = transform(to_template.transform, aoi_wgs84)
    minx, miny, maxx, maxy = aoi_in_template.bounds

    corners = [(minx, miny), (minx, maxy), (maxx, miny), (maxx, maxy)]
    rcs = [ds.index(x, y) for x, y in corners]
    rows = [rc[0] for rc in rcs]
    cols = [rc[1] for rc in rcs]

    r0 = int(np.clip(min(rows), 0, ds.height - 1))
    r1 = int(np.clip(max(rows), 0, ds.height - 1))
    c0 = int(np.clip(min(cols), 0, ds.width - 1))
    c1 = int(np.clip(max(cols), 0, ds.width - 1))

    rr, cc = np.meshgrid(np.arange(r0, r1 + 1), np.arange(c0, c1 + 1), indexing="ij")
    xs, ys = xy(ds.transform, rr, cc, offset="center")
    xs = np.asarray(xs, dtype=np.float64).ravel()
    ys = np.asarray(ys, dtype=np.float64).ravel()

    lon, lat = to_wgs.transform(xs, ys)
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)

  mask = np.zeros(lon.size, dtype=bool)
  for i in range(lon.size):
    p = Point(float(lon[i]), float(lat[i]))
    mask[i] = bool(aoi_wgs84.contains(p) or aoi_wgs84.touches(p))

  lon = lon[mask]
  lat = lat[mask]

  tx_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
  x_m, y_m = tx_utm.transform(lon, lat)
  df = pd.DataFrame(
    {
      "lon": lon,
      "lat": lat,
      "x_utm_m": np.asarray(x_m, dtype=np.float64),
      "y_utm_m": np.asarray(y_m, dtype=np.float64),
    }
  )
  df = df.replace([np.inf, -np.inf], np.nan).dropna(subset=["lon", "lat", "x_utm_m", "y_utm_m"]).reset_index(drop=True)
  df.insert(0, "grid_id", np.arange(1, len(df) + 1, dtype=int))
  return df


def _sample_raster_points(path: Path, lon: np.ndarray, lat: np.ndarray) -> Tuple[np.ndarray, Dict[str, Any]]:
  with rasterio.open(path) as ds:
    if ds.crs is None:
      raise RuntimeError(f"Raster has no CRS: {path}")

    crs = CRS.from_user_input(ds.crs)
    nodata = ds.nodata

    if crs == CRS.from_epsg(4326):
      xs = lon
      ys = lat
    else:
      tx = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
      xs, ys = tx.transform(lon.tolist(), lat.tolist())
      xs = np.asarray(xs, dtype=np.float64)
      ys = np.asarray(ys, dtype=np.float64)

    coords = np.column_stack([xs, ys])
    vals = np.array([v[0] for v in ds.sample(coords)], dtype=np.float64)
    if nodata is not None:
      vals = np.where(vals == float(nodata), np.nan, vals)
    vals = np.where(np.isfinite(vals), vals, np.nan)

    info = {
      "path": str(path),
      "crs": crs.to_string(),
      "nodata": float(nodata) if nodata is not None and np.isfinite(nodata) else nodata,
      "shape": [int(ds.height), int(ds.width)],
      "res": [float(ds.res[0]), float(ds.res[1])],
      "bounds": list(ds.bounds),
    }
    return vals, info


def _apply_missing_rules(df: pd.DataFrame) -> pd.DataFrame:
  out = df.copy()
  for c in [
    "sand_pct",
    "silt_pct",
    "clay_pct",
    "bulk_density",
    "water_content",
    "course_fragments",
    "bedrock_depth_m",
    "elevation_m",
  ]:
    if c in out.columns:
      out[c] = pd.to_numeric(out[c], errors="coerce")

  if all(c in out.columns for c in ("sand_pct", "silt_pct", "clay_pct")):
    s = pd.to_numeric(out["sand_pct"], errors="coerce").fillna(0)
    si = pd.to_numeric(out["silt_pct"], errors="coerce").fillna(0)
    cl = pd.to_numeric(out["clay_pct"], errors="coerce").fillna(0)
    zero_sum = (s + si + cl) == 0
    out.loc[zero_sum, ["sand_pct", "silt_pct", "clay_pct"]] = np.nan

  for c in ("bulk_density", "water_content"):
    if c in out.columns:
      out.loc[pd.to_numeric(out[c], errors="coerce") <= 0, c] = np.nan

  if "bedrock_depth_m" in out.columns:
    out.loc[pd.to_numeric(out["bedrock_depth_m"], errors="coerce") <= 0, "bedrock_depth_m"] = np.nan

  if "course_fragments" in out.columns:
    out.loc[pd.to_numeric(out["course_fragments"], errors="coerce") < 0, "course_fragments"] = np.nan

  if "elevation_m" in out.columns:
    out.loc[pd.to_numeric(out["elevation_m"], errors="coerce") <= 0, "elevation_m"] = np.nan

  return out


def _estimate_res_m(info: Dict[str, Any], ref_lon: float, ref_lat: float) -> float:
  res = info.get("res")
  crs = str(info.get("crs") or "")
  if not isinstance(res, list) or len(res) != 2:
    return 500.0
  rx = float(res[0])
  ry = float(res[1])

  if crs.upper() == "EPSG:4326":
    tx = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
    x0, y0 = tx.transform(ref_lon, ref_lat)
    x1, y1 = tx.transform(ref_lon + rx, ref_lat)
    x2, y2 = tx.transform(ref_lon, ref_lat + ry)
    dx = float(np.hypot(x1 - x0, y1 - y0))
    dy = float(np.hypot(x2 - x0, y2 - y0))
    return float(max(dx, dy))

  if crs.upper().startswith("EPSG:"):
    return float(max(abs(rx), abs(ry)))

  return 500.0


@dataclass(frozen=True)
class IdwResult:
  filled: np.ndarray
  was_interpolated: np.ndarray
  interp_max_dist_m: np.ndarray


def _idw_fill(values: np.ndarray, x_m: np.ndarray, y_m: np.ndarray, *, k: int, p: float, max_dist_m: float) -> IdwResult:
  v = np.asarray(values, dtype=np.float64)
  x = np.asarray(x_m, dtype=np.float64)
  y = np.asarray(y_m, dtype=np.float64)
  if not (v.size == x.size == y.size):
    raise RuntimeError("IDW fill received mismatched array lengths")

  missing = ~np.isfinite(v)
  if not missing.any():
    return IdwResult(filled=v, was_interpolated=np.zeros(v.size, dtype=bool), interp_max_dist_m=np.zeros(v.size, dtype=np.float64))

  valid = ~missing
  if int(valid.sum()) < k:
    raise RuntimeError("Too few valid points to perform IDW fill")

  tree = KDTree(np.column_stack([x[valid], y[valid]]))
  dist, ind = tree.query(np.column_stack([x[missing], y[missing]]), k=min(k, int(valid.sum())))

  valid_vals = v[valid]
  out = v.copy()
  was = np.zeros(v.size, dtype=bool)
  maxd = np.zeros(v.size, dtype=np.float64)
  missing_idx = np.where(missing)[0]

  for i in range(dist.shape[0]):
    d = dist[i]
    idx = ind[i]
    if float(np.max(d)) > float(max_dist_m):
      raise RuntimeError(
        f"IDW fill failed: no valid neighbors within {max_dist_m:.0f} m for at least one missing point"
      )
    if np.any(d == 0):
      out[missing_idx[i]] = float(valid_vals[idx[np.argmin(d)]])
      was[missing_idx[i]] = True
      maxd[missing_idx[i]] = 0.0
      continue
    w = 1.0 / np.power(d, p)
    wsum = float(np.sum(w))
    out[missing_idx[i]] = float(np.sum(w * valid_vals[idx]) / wsum) if wsum > 0 else float(valid_vals[idx[0]])
    was[missing_idx[i]] = True
    maxd[missing_idx[i]] = float(np.max(d))

  return IdwResult(filled=out, was_interpolated=was, interp_max_dist_m=maxd)


def _load_union_geometry(path: Path, dst_crs: CRS, *, fallback_crs: CRS | None = None) -> Any:
  with fiona.open(path) as src:
    src_crs_raw = src.crs_wkt or src.crs
    if src_crs_raw:
      src_crs = CRS.from_user_input(src_crs_raw)
    elif fallback_crs is not None:
      src_crs = fallback_crs
    else:
      raise RuntimeError(f"Missing CRS for shapefile (no .prj): {path}")
    geoms = [shape(feat["geometry"]) for feat in src if feat.get("geometry")]
  if not geoms:
    raise RuntimeError(f"No geometries found: {path}")
  geom = unary_union(geoms)
  if src_crs == dst_crs:
    return geom
  tx = Transformer.from_crs(src_crs, dst_crs, always_xy=True)
  return transform(tx.transform, geom)


def _min_distance_m(points_xy: np.ndarray, geom_utm: Any) -> np.ndarray:
  out = np.zeros(points_xy.shape[0], dtype=np.float64)
  for i in range(points_xy.shape[0]):
    out[i] = float(geom_utm.distance(Point(float(points_xy[i, 0]), float(points_xy[i, 1]))))
  return out


def _derive_slope_aspect_twi(dem_path: Path, lon: np.ndarray, lat: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
  with rasterio.open(dem_path) as ds:
    arr = ds.read(1).astype(np.float64)
    nodata = ds.nodata
    if nodata is not None:
      arr = np.where(arr == float(nodata), np.nan, arr)
    arr = np.where(np.isfinite(arr), arr, np.nan)

    if ds.crs is None:
      raise RuntimeError(f"DEM has no CRS: {dem_path}")

    crs = CRS.from_user_input(ds.crs)
    dx = float(abs(ds.res[0]))
    dy = float(abs(ds.res[1]))

    if crs == CRS.from_epsg(4326):
      lat0 = float(np.nanmedian(lat))
      phi = np.deg2rad(lat0)
      m_per_deg_lat = 111320.0
      m_per_deg_lon = 111320.0 * float(np.cos(phi))
      dx_m = dx * m_per_deg_lon
      dy_m = dy * m_per_deg_lat
      gy, gx = np.gradient(arr, dy_m, dx_m)
    else:
      gy, gx = np.gradient(arr, dy, dx)

    slope = np.degrees(np.arctan(np.sqrt(gx * gx + gy * gy)))
    aspect = (np.degrees(np.arctan2(-gx, gy)) + 360.0) % 360.0

    if crs == CRS.from_epsg(4326):
      xs = lon
      ys = lat
    else:
      tx = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
      xs, ys = tx.transform(lon.tolist(), lat.tolist())
      xs = np.asarray(xs, dtype=np.float64)
      ys = np.asarray(ys, dtype=np.float64)

    rows, cols = rowcol(ds.transform, xs, ys)
    rows = np.clip(np.asarray(rows), 0, ds.height - 1)
    cols = np.clip(np.asarray(cols), 0, ds.width - 1)

    slope_s = slope[rows, cols]
    aspect_s = aspect[rows, cols]

    slope_med = float(np.nanmedian(slope)) if np.isfinite(slope).any() else 0.0
    aspect_med = float(np.nanmedian(aspect)) if np.isfinite(aspect).any() else 0.0
    slope_s = np.where(np.isfinite(slope_s), slope_s, slope_med)
    aspect_s = np.where(np.isfinite(aspect_s), aspect_s, aspect_med)

    beta = np.deg2rad(np.clip(slope_s, 0.0, 89.9))
    twi = np.log(1.0 / (np.tan(beta) + 1e-6))
    twi = np.where(np.isfinite(twi), twi, float(np.nanmedian(twi) if np.isfinite(twi).any() else 0.0))
    return slope_s.astype(np.float64), aspect_s.astype(np.float64), twi.astype(np.float64)


def _write_geojson(path: Path, geom_wgs84: Any, props: Dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": props, "geometry": mapping(geom_wgs84)}]}
  path.write_text(json.dumps(fc, indent=2), encoding="utf-8")


def main(argv: Iterable[str] | None = None) -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--data-dir", default=str(REPO_ROOT / "ISLAMABD DATA"))
  ap.add_argument("--outputs-dir", default=str(REPO_ROOT / "outputs"))
  ap.add_argument("--buffer-m", type=float, default=200.0)
  ap.add_argument("--aoi-mode", choices=["bender", "bender_vs30"], default="bender")
  ap.add_argument("--vs30-xlsx", default=str(REPO_ROOT / "ISLAMABD DATA" / "Table3_VS30.xlsx"))
  ap.add_argument("--idw-max-dist-m", type=float, default=500.0)
  ap.add_argument("--idw-k", type=int, default=3)
  ap.add_argument("--idw-p", type=float, default=2.0)
  args = ap.parse_args(list(argv) if argv is not None else None)

  data_dir = Path(args.data_dir).resolve()
  outputs_dir = Path(args.outputs_dir).resolve()
  preds_dir = outputs_dir / "predictions"
  metrics_dir = outputs_dir / "metrics"

  _clean_outputs(outputs_dir)
  preds_dir.mkdir(parents=True, exist_ok=True)
  metrics_dir.mkdir(parents=True, exist_ok=True)

  bender_csv = data_dir / "islamabad local land test.csv"
  if not bender_csv.exists():
    print(f"Phase 1 FAIL: missing bender CSV: {bender_csv}")
    return 2

  bender = _read_bender_points(bender_csv)
  bender = bender[pd.to_numeric(bender["gmax_mpa"], errors="coerce").notna()].reset_index(drop=True)
  if len(bender) != 27:
    print(f"Phase 1 FAIL: expected 27 bender points with Gmax, got {len(bender)}")
    return 2

  aoi_points = bender[["lon", "lat"]].copy()
  vs30_included = 0
  if args.aoi_mode == "bender_vs30":
    vs30_path = Path(args.vs30_xlsx)
    if not vs30_path.exists():
      print(f"Phase 1 FAIL: missing VS30 XLSX: {vs30_path}")
      return 2
    vs30 = _read_vs30_points(vs30_path)
    vs30_included = int(len(vs30))
    aoi_points = pd.concat([aoi_points, vs30[["lon", "lat"]]], axis=0).reset_index(drop=True)

  aoi_wgs84, aoi_meta = _aoi_rectangle_wgs84(aoi_points, buffer_m=float(args.buffer_m))
  aoi_geojson = preds_dir / "aoi_polygon.geojson"
  _write_geojson(
    aoi_geojson,
    aoi_wgs84,
    {"name": f"AOI ({args.aoi_mode} rect + buffer)", "crs": "EPSG:4326", "vs30_points": vs30_included},
  )

  template = data_dir / "sand content.tif"
  if not template.exists():
    print(f"Phase 1 FAIL: missing template raster: {template}")
    return 2

  grid = _grid_from_template(template, aoi_wgs84)
  if len(grid) == 0:
    print("Phase 1 FAIL: AOI produced 0 grid points")
    return 2

  lon = grid["lon"].to_numpy(dtype=np.float64)
  lat = grid["lat"].to_numpy(dtype=np.float64)
  x_m = grid["x_utm_m"].to_numpy(dtype=np.float64)
  y_m = grid["y_utm_m"].to_numpy(dtype=np.float64)
  pts_xy = np.column_stack([x_m, y_m])

  raster_map = {
    "sand_pct": "sand content.tif",
    "silt_pct": "silt content.tif",
    "clay_pct": "clay content.tif",
    "bulk_density": "bulk density.tif",
    "water_content": "water content.tif",
    "course_fragments": "course fragment.tif",
    "land_cover_class": "land cover.tif",
    "bedrock_depth_m": "bedrock 10 km islamabad.tif",
    "elevation_m": "Elevation.tif",
  }

  raster_info: Dict[str, Any] = {}
  for out_name, fname in raster_map.items():
    p = data_dir / fname
    if not p.exists():
      print(f"Phase 1 FAIL: missing raster: {p}")
      return 2
    vals, info = _sample_raster_points(p, lon, lat)
    raster_info[out_name] = info
    grid[out_name] = vals

  grid = _apply_missing_rules(grid)

  interp_summary: Dict[str, Any] = {}
  ref_lon = float(np.median(lon))
  ref_lat = float(np.median(lat))
  for out_name in raster_map.keys():
    v = pd.to_numeric(grid[out_name], errors="coerce").to_numpy(dtype=np.float64)

    base_max = float(args.idw_max_dist_m)
    res_m = _estimate_res_m(raster_info.get(out_name, {}), ref_lon, ref_lat)
    max_dist = float(max(base_max, 1.5 * res_m))

    used_max = base_max
    fallback_median_used = 0
    try:
      res = _idw_fill(v, x_m, y_m, k=int(args.idw_k), p=float(args.idw_p), max_dist_m=base_max)
    except RuntimeError:
      used_max = float(max(2000.0, max_dist))
      try:
        res = _idw_fill(v, x_m, y_m, k=int(args.idw_k), p=float(args.idw_p), max_dist_m=used_max)
      except RuntimeError:
        vv = np.asarray(v, dtype=np.float64)
        med = float(np.nanmedian(vv[np.isfinite(vv)])) if np.isfinite(vv).any() else 0.0
        missing_mask = ~np.isfinite(vv)
        filled = vv.copy()
        filled[missing_mask] = med
        res = IdwResult(
          filled=filled,
          was_interpolated=missing_mask.astype(bool),
          interp_max_dist_m=np.where(missing_mask, float("nan"), 0.0).astype(np.float64),
        )
        fallback_median_used = int(np.sum(missing_mask))

    grid[out_name] = res.filled
    grid[f"interpolated_{out_name}"] = res.was_interpolated.astype(int)
    grid[f"interp_max_dist_m_{out_name}"] = res.interp_max_dist_m
    grid[f"idw_radius_m_{out_name}"] = float(used_max)
    grid[f"fallback_median_filled_{out_name}"] = 0
    if fallback_median_used:
      grid.loc[res.was_interpolated.astype(bool), f"fallback_median_filled_{out_name}"] = 1
    interp_summary[out_name] = {
      "missing_before": int(np.sum(~np.isfinite(v))),
      "interpolated_count": int(np.sum(res.was_interpolated)),
      "max_interp_distance_m": float(np.max(res.interp_max_dist_m)) if res.was_interpolated.any() else 0.0,
      "idw_radius_m_used": float(used_max),
      "idw_radius_m_max": float(max_dist),
      "fallback_median_filled_count": int(fallback_median_used),
    }

  dem_path = data_dir / "dem.tif"
  if not dem_path.exists():
    print(f"Phase 1 FAIL: missing DEM: {dem_path}")
    return 2
  slope_deg, aspect_deg, twi = _derive_slope_aspect_twi(dem_path, lon, lat)
  grid["slope_degrees"] = slope_deg
  grid["aspect_degrees"] = aspect_deg
  grid["topographic_wetness_index"] = twi

  crs_utm = CRS.from_epsg(32643)
  water_geom = _load_union_geometry(data_dir / "water bodies.shp", crs_utm, fallback_crs=CRS.from_epsg(4326))
  waterways_geom = _load_union_geometry(data_dir / "water ways.shp", crs_utm, fallback_crs=CRS.from_epsg(4326))
  fault_geom = _load_union_geometry(data_dir / "fault line.shp", crs_utm, fallback_crs=CRS.from_epsg(4326))
  water_union = unary_union([water_geom, waterways_geom])

  grid["dist_to_water_m"] = _min_distance_m(pts_xy, water_union)
  grid["dist_to_fault_m"] = _min_distance_m(pts_xy, fault_geom)

  nan_counts = {c: int(pd.to_numeric(grid[c], errors="coerce").isna().sum()) for c in list(raster_map.keys()) + ["slope_degrees", "aspect_degrees", "topographic_wetness_index", "dist_to_water_m", "dist_to_fault_m"]}
  nan_ok = all(v == 0 for v in nan_counts.values())
  if not nan_ok:
    print("Phase 1 FAIL: NaNs remain after interpolation")
    bad = {k: v for k, v in nan_counts.items() if v != 0}
    print(str(bad))
    return 2

  out_grid = preds_dir / "aoi_grid_complete.csv"
  grid.to_csv(out_grid, index=False)

  targets = bender[["sector", "lon", "lat", "gmax_mpa", "ll", "pl", "pi"]].copy()
  out_targets = preds_dir / "islamabad_targets_clean.csv"
  targets.to_csv(out_targets, index=False)

  report = {
    "phase": 1,
    "generated_at": _now_iso(),
    "ok": True,
    "inputs": {
      "data_dir": str(data_dir),
      "bender_csv": str(bender_csv),
      "aoi_mode": str(args.aoi_mode),
      "vs30_included": int(vs30_included),
      "rasters": raster_info,
      "idw": {"k": int(args.idw_k), "p": float(args.idw_p), "max_dist_m": float(args.idw_max_dist_m)},
    },
    "aoi": {"geojson": str(aoi_geojson), **aoi_meta},
    "grid": {"points": int(len(grid)), "nan_counts": nan_counts},
    "interpolation": interp_summary,
    "outputs": {"aoi_grid_complete_csv": str(out_grid), "targets_csv": str(out_targets)},
  }
  (metrics_dir / "phase1_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

  print("Phase 1 PASS")
  print(str(out_grid))
  print(str(out_targets))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
