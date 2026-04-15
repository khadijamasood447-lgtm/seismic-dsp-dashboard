from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import fiona
import numpy as np
import rasterio
import rasterio.features
import rasterio.warp
from pyproj import CRS, Transformer
from shapely.geometry import shape
from shapely.ops import unary_union


@dataclass(frozen=True)
class LayerSpec:
    id: str
    path: Path
    resampling: str
    unit: str | None = None
    scale: float = 1.0
    offset: float = 0.0


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_resampling(name: str) -> rasterio.warp.Resampling:
    s = name.strip().lower()
    mapping = {
        "nearest": rasterio.warp.Resampling.nearest,
        "bilinear": rasterio.warp.Resampling.bilinear,
        "cubic": rasterio.warp.Resampling.cubic,
        "average": rasterio.warp.Resampling.average,
        "mode": rasterio.warp.Resampling.mode,
        "max": rasterio.warp.Resampling.max,
        "min": rasterio.warp.Resampling.min,
        "med": rasterio.warp.Resampling.med,
        "q1": rasterio.warp.Resampling.q1,
        "q3": rasterio.warp.Resampling.q3,
    }
    if s not in mapping:
        raise ValueError(f"Unsupported resampling='{name}'. Supported: {sorted(mapping)}")
    return mapping[s]


def load_aoi_geometry(aoi_path: Path) -> tuple[Any, CRS]:
    with fiona.open(aoi_path) as src:
        src_crs = CRS.from_user_input(src.crs_wkt or src.crs)
        geoms = [shape(feat["geometry"]) for feat in src if feat.get("geometry")]
    if not geoms:
        raise ValueError(f"AOI shapefile has no geometries: {aoi_path}")
    return unary_union(geoms), src_crs


def reproject_geometry(geom: Any, src_crs: CRS, dst_crs: CRS) -> Any:
    if src_crs == dst_crs:
        return geom
    transformer = Transformer.from_crs(src_crs, dst_crs, always_xy=True)

    def _tx(x: float, y: float, z: float | None = None) -> tuple[float, float]:
        xx, yy = transformer.transform(x, y)
        return (xx, yy)

    from shapely.ops import transform

    return transform(_tx, geom)


def compute_stats(arr: np.ndarray, nodata: float) -> dict[str, Any]:
    a = np.asarray(arr, dtype=float)
    mask = np.isfinite(a) & (a != nodata)
    n_total = int(a.size)
    n_valid = int(mask.sum())
    if n_valid == 0:
        return {
            "n_total": n_total,
            "n_valid": n_valid,
            "pct_nodata": 100.0,
            "min": None,
            "max": None,
            "mean": None,
            "std": None,
        }
    vals = a[mask]
    return {
        "n_total": n_total,
        "n_valid": n_valid,
        "pct_nodata": float(100.0 * (1.0 - (n_valid / n_total))),
        "min": float(np.min(vals)),
        "max": float(np.max(vals)),
        "mean": float(np.mean(vals)),
        "std": float(np.std(vals)),
    }


def iter_layer_specs(config: dict[str, Any], root: Path) -> list[LayerSpec]:
    out: list[LayerSpec] = []
    for layer in config.get("layers", []):
        out.append(
            LayerSpec(
                id=str(layer["id"]).strip(),
                path=(root / str(layer["path"]).strip()).resolve(),
                resampling=str(layer.get("resampling", "bilinear")),
                unit=(str(layer["unit"]) if layer.get("unit") is not None else None),
                scale=float(layer.get("scale", 1.0)),
                offset=float(layer.get("offset", 0.0)),
            )
        )
    return out


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def standardize_one(
    spec: LayerSpec,
    ref_profile: dict[str, Any],
    ref_transform: rasterio.Affine,
    ref_crs: CRS,
    ref_shape: tuple[int, int],
    aoi_geom_ref: Any,
    out_dir: Path,
    nodata: float,
) -> dict[str, Any]:
    with rasterio.open(spec.path) as src:
        src_crs = CRS.from_user_input(src.crs)
        src_nodata = src.nodata
        src_arr = src.read(1)
        src_transform = src.transform

    dst = np.full(ref_shape, nodata, dtype=np.float32)
    rasterio.warp.reproject(
        source=src_arr,
        destination=dst,
        src_transform=src_transform,
        src_crs=src_crs,
        src_nodata=src_nodata,
        dst_transform=ref_transform,
        dst_crs=ref_crs,
        dst_nodata=nodata,
        resampling=normalize_resampling(spec.resampling),
    )

    aoi_mask = rasterio.features.geometry_mask(
        [aoi_geom_ref.__geo_interface__],
        out_shape=ref_shape,
        transform=ref_transform,
        invert=True,
        all_touched=False,
    )
    dst = np.where(aoi_mask, dst, nodata).astype(np.float32)

    if not (math.isclose(spec.scale, 1.0) and math.isclose(spec.offset, 0.0)):
        valid = np.isfinite(dst) & (dst != nodata)
        dst = np.where(valid, dst * float(spec.scale) + float(spec.offset), nodata).astype(np.float32)

    out_path = out_dir / f"{spec.id}.tif"
    profile = dict(ref_profile)
    profile.update(
        {
            "count": 1,
            "dtype": "float32",
            "nodata": nodata,
        }
    )
    with rasterio.open(out_path, "w", **profile) as dst_ds:
        dst_ds.write(dst, 1)

    return {
        "id": spec.id,
        "source": str(spec.path),
        "output": str(out_path),
        "resampling": spec.resampling,
        "unit": spec.unit,
        "scale": spec.scale,
        "offset": spec.offset,
        "stats": compute_stats(dst, nodata),
    }


def main(argv: Iterable[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--layers", nargs="*", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(list(argv) if argv is not None else None)

    root = Path(__file__).resolve().parents[1]
    cfg_path = (root / args.config).resolve()
    cfg = read_json(cfg_path)

    ref_path = (root / str(cfg["reference_raster"])).resolve()
    aoi_path = (root / str(cfg["aoi"]["path"])).resolve()

    out_dir = root / str(cfg["output"]["dir"])
    nodata = float(cfg["output"].get("nodata", -9999))

    with rasterio.open(ref_path) as ref:
        ref_crs = CRS.from_user_input(ref.crs)
        ref_transform = ref.transform
        ref_shape = (ref.height, ref.width)
        ref_profile = ref.profile

    aoi_geom, aoi_crs = load_aoi_geometry(aoi_path)
    aoi_geom_ref = reproject_geometry(aoi_geom, aoi_crs, ref_crs)

    layers = iter_layer_specs(cfg, root)
    if args.layers:
        requested = {s.strip() for s in args.layers if s.strip()}
        layers = [s for s in layers if s.id in requested]

    metadata: dict[str, Any] = {
        "name": cfg.get("name"),
        "config": str(cfg_path),
        "reference_raster": str(ref_path),
        "aoi": str(aoi_path),
        "grid": {
            "crs": ref_crs.to_string(),
            "transform": list(ref_transform)[:6],
            "shape": {"height": ref_shape[0], "width": ref_shape[1]},
            "bounds": None,
        },
        "layers": [],
    }

    west, south, east, north = rasterio.transform.array_bounds(ref_shape[0], ref_shape[1], ref_transform)
    metadata["grid"]["bounds"] = {"left": west, "bottom": south, "right": east, "top": north}

    if args.dry_run:
        print(json.dumps(metadata, indent=2))
        return

    ensure_dir(out_dir)

    tiled = bool(cfg["output"].get("tiled", True))
    if tiled and (ref_shape[1] < 16 or ref_shape[0] < 16):
        tiled = False

    blockxsize = None
    blockysize = None
    if tiled:
        blockxsize = max(16, min(256, (ref_shape[1] // 16) * 16))
        blockysize = max(16, min(256, (ref_shape[0] // 16) * 16))

    ref_profile_out = dict(ref_profile)
    ref_profile_out.update(
        {
            "driver": "GTiff",
            "compress": cfg["output"].get("compress", "deflate"),
            "tiled": tiled,
            "interleave": "band",
            "BIGTIFF": "IF_SAFER",
        }
    )

    if tiled and blockxsize and blockysize:
        ref_profile_out.update({"blockxsize": int(blockxsize), "blockysize": int(blockysize)})

    for spec in layers:
        info = standardize_one(
            spec=spec,
            ref_profile=ref_profile_out,
            ref_transform=ref_transform,
            ref_crs=ref_crs,
            ref_shape=ref_shape,
            aoi_geom_ref=aoi_geom_ref,
            out_dir=out_dir,
            nodata=nodata,
        )
        metadata["layers"].append(info)

    (out_dir / "_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(str(out_dir / "_metadata.json"))


if __name__ == "__main__":
    main()

