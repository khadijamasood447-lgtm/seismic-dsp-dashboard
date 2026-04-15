from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--meta",
        default="data/gis/islamabad_zone1/standardized/_metadata.json",
        help="Path to standardized _metadata.json (contains AOI shapefile path)",
    )
    ap.add_argument(
        "--out",
        default="public/islamabad_admin_boundary.geojson",
        help="Output GeoJSON path",
    )
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    meta_path = (root / args.meta).resolve()
    out_path = (root / args.out).resolve()

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    aoi_path = Path(meta.get("aoi", "")).expanduser()
    if not aoi_path.exists():
        raise SystemExit(f"AOI shapefile not found: {aoi_path}")

    import fiona  # type: ignore

    features = []
    with fiona.open(aoi_path) as src:
        for feat in src:
            geom = feat.get("geometry")
            if geom is None:
                continue
            if hasattr(geom, "__geo_interface__"):
                geom = geom.__geo_interface__
            else:
                geom = dict(geom)
            props = feat.get("properties") or {}
            features.append({"type": "Feature", "geometry": geom, "properties": dict(props)})

    if not features:
        raise SystemExit("No geometries found in AOI")

    fc = {"type": "FeatureCollection", "features": features}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
