# Project Context (for continuity)

This file is a lightweight, human-readable place to keep key decisions and current state so work can resume quickly in future sessions.

## Current status

- ML: Cyclic triaxial “Option A” v4 exists as an offline Python training pipeline. The chosen canonical artifact set is `data/training/cyclic_triaxial_v4/models/` + `production_report.json` (see `data/training/cyclic_triaxial_v4/BEST_MODEL.md`).
- GIS: Islamabad Zone-1 rasters are standardized onto one grid (DEM reference) and clipped to AOI. Outputs live in `data/gis/islamabad_zone1/standardized/` with `_metadata.json`.
- App: Next.js dashboard includes chat (/api/chat), IFC screening (/api/analyze-ifc), PDF report generation (/api/generate-report), and e-permit workflow routes/pages.
- IFC visualization (Phase 1): Chat can upload .ifc via `/api/visualize-ifc` (Supabase Storage signed URL). The existing 3D page renders IFC client-side using Three.js `IFCLoader` with `web-ifc` wasm served from `public/wasm/`.
- Deployment: Railway config removed; Vercel config added (`vercel.json`). Large datasets/assets are excluded via `.gitignore` and `.vercelignore` (e.g., `ISLAMABD DATA/`, `pdf_extracted/`, `data/training/`, and large video files under `public/videos/*.mp4`).

## Islamabad model training

- Point-sampling pipeline is in place to train a local Islamabad model from your lab results once you add them.
- Build dataset (sample GIS layers at test coordinates): `python scripts/build_islamabad_training_points.py --points <csv|xlsx> --out data/training/islamabad_v1/points_sampled.csv`
- Train model(s) from sampled dataset: `python scripts/train_islamabad_local_model.py --dataset data/training/islamabad_v1/points_sampled.csv --targets <col1,col2> --out-dir data/training/islamabad_v1/models_v1`
- Template input file: `data/training/islamabad_v1/local_tests_template.csv`
- Bender Element test source CSV currently lives at `data/gis/islamabad_zone1/standardized/islamabad local land test.csv`.
- Prepare BE training dataset (cleans columns + normalizes names): `python scripts/prepare_islamabad_be_dataset.py --in "data/gis/islamabad_zone1/standardized/islamabad local land test.csv" --out data/training/islamabad_v1/be_dataset_clean.csv`
- Sample BE dataset against rasters: `python scripts/build_islamabad_training_points.py --points data/training/islamabad_v1/be_dataset_clean.csv --out data/training/islamabad_v1/be_dataset_sampled.csv --lon-col lon --lat-col lat --id-col site_id`
- Train Vs/Vp models (BE v1): `python scripts/train_islamabad_local_model.py --dataset data/training/islamabad_v1/be_dataset_sampled.csv --targets vs_sw,vp_pw --out-dir data/training/islamabad_v1/be_model_v1`
- Predict full-grid Vs/Vp rasters + validate at test points: `python scripts/predict_islamabad_rasters.py --model-dir data/training/islamabad_v1/be_model_v1 --out-dir data/training/islamabad_v1/be_model_v1/predictions --points data/training/islamabad_v1/be_dataset_sampled.csv`

### Adding PGA / research tables
- If you rasterize PGA and any paper-derived water table onto the same standardized grid, place them as GeoTIFFs in `data/gis/islamabad_zone1/standardized/` (e.g., `pga.tif`, `gw_depth.tif`).
- The sampling script automatically includes any `*.tif` in that folder (except `_index.tif`) as features.

## Standardized Islamabad layers

- `dem` (m)
- `bulk_density` (g/cm3; scaled by 0.01)
- `sand_pct` (%; scaled by 0.1)
- `silt_pct` (%; scaled by 0.1)
- `clay_pct` (%; scaled by 0.1)
- `vs30` (m/s)
- `water_content` (%; scaled by 0.1)
- `land_cover` (class; nearest resampling)
- `bedrock_depth_10km` (m)

## Planned additions

- Bender Element (BE) lab data: collect as a growing dataset; only integrate into cyclic model after pairing BE + cyclic tests, and version the model (keep v4 as baseline).
- Groundwater and PGA from papers: treat as authoritative tables/points first; later rasterize/interpolate onto the standardized grid with explicit provenance.

## Backend direction

- Recommended: Postgres/PostGIS for metadata + spatial queries, plus object storage (e.g., Cloudflare R2 or S3) for large files (IFC, GeoTIFF, PDFs).

## Storage/Auth options
 
- Supabase: integrated Postgres + Auth + Storage; easy policies (RLS). Use if you want one managed stack.
- Cloudflare: R2 for object storage, Workers/Pages for edge compute; pair with managed Postgres (e.g., Neon) via `pg`.
- Google Drive: workable for artifact storage via API; use OAuth2 and a specific folder shared with the app credentials.
- Dropbox: not suitable for programmatic datasets or structured queries; avoid for backend storage.
- To validate connectivity: run dev server and hit `/api/supabase/ping-public` (anon-key check). Storage listing requires adding `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`).

## Current choice
- Storage provider target: Cloudflare R2 (or S3) for large artifacts; DB remains Postgres/PostGIS via `pg`.
- Storage provider target: Google Drive (folder-based) for large artifacts under `geonexus2026@gmail.com`; DB remains Postgres/PostGIS via `pg`.

### Google Drive setup
- Create OAuth credentials and obtain a refresh token.
- Add envs: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_FOLDER_ID`.
- Endpoints available:
  - `/api/drive/list` → lists files in `DRIVE_FOLDER_ID`
  - `/api/drive/upload` (POST multipart `file`) → uploads to `DRIVE_FOLDER_ID`
- Storage provider target: Supabase Storage (free tier) for large artifacts; DB remains Postgres/PostGIS.

## Notes


