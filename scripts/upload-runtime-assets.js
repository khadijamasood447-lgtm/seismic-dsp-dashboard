const fs = require("fs")
const path = require("path")
const { createClient } = require("@supabase/supabase-js")

function loadLocalEnv(root) {
  const p = path.join(root, ".env.local")
  if (!fs.existsSync(p)) return
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1")
    if (!(key in process.env)) process.env[key] = value
  }
}

function must(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name}`)
  return v
}

async function main() {
  const root = process.cwd()
  loadLocalEnv(root)
  const url = must("NEXT_PUBLIC_SUPABASE_URL")
  const key = must("SUPABASE_SERVICE_ROLE_KEY")
  const bucket = process.env.SUPABASE_RUNTIME_BUCKET || "predictions_cache"

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const assets = [
    {
      local: path.join(root, "public", "islamabad_grid_bundle.json"),
      remote: process.env.SUPABASE_GRID_BUNDLE_PATH || "runtime/islamabad_grid_bundle.json",
      contentType: "application/json",
    },
    {
      local: path.join(root, "public", "liquefaction", "predictions_bundle.json"),
      remote: "runtime/liquefaction/predictions_bundle.json",
      contentType: "application/json",
      optional: true,
    },
    {
      local: path.join(root, "public", "liquefaction", "predictions_points.csv"),
      remote: "runtime/liquefaction/predictions_points.csv",
      contentType: "text/csv",
      optional: true,
    },
  ]

  for (const asset of assets) {
    if (!fs.existsSync(asset.local)) {
      if (asset.optional) continue
      throw new Error(`Missing local file: ${asset.local}`)
    }
    const body = fs.readFileSync(asset.local)
    const { error } = await supabase.storage.from(bucket).upload(asset.remote, body, {
      contentType: asset.contentType,
      upsert: true,
    })
    if (error) throw error
    process.stdout.write(`Uploaded ${asset.local} -> ${bucket}/${asset.remote}\n`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
