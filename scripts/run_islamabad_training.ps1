param(
  [Parameter(Mandatory = $true)]
  [string]$Points,
  [Parameter(Mandatory = $true)]
  [string]$Targets,
  [string]$OutDir = "data/training/islamabad_v1",
  [string]$StandardizedDir = "data/gis/islamabad_zone1/standardized",
  [string]$LonCol = "lon",
  [string]$LatCol = "lat",
  [string]$GroupCol = ""
)

$ErrorActionPreference = "Stop"

$sampled = Join-Path $OutDir "points_sampled.csv"

python scripts/build_islamabad_training_points.py `
  --standardized-dir $StandardizedDir `
  --points $Points `
  --out $sampled `
  --lon-col $LonCol `
  --lat-col $LatCol

if ($GroupCol -ne "") {
  python scripts/train_islamabad_local_model.py --dataset $sampled --targets $Targets --out-dir $OutDir --group-col $GroupCol
} else {
  python scripts/train_islamabad_local_model.py --dataset $sampled --targets $Targets --out-dir $OutDir
}

