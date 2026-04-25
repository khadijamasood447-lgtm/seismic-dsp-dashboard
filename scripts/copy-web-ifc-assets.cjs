const fs = require("fs")
const path = require("path")

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function copy(from, to) {
  ensureDir(path.dirname(to))
  fs.copyFileSync(from, to)
}

console.log("📦 Copying web-ifc assets...")

try {
  const outDir = path.join(process.cwd(), "public", "wasm")
  ensureDir(outDir)

  const pkgDir = path.dirname(require.resolve("web-ifc"))
  const assets = [
    { from: path.join(pkgDir, "web-ifc.wasm"), to: path.join(outDir, "web-ifc.wasm") },
    { from: path.join(pkgDir, "web-ifc-mt.wasm"), to: path.join(outDir, "web-ifc-mt.wasm") },
    { from: path.join(pkgDir, "web-ifc-mt.worker.js"), to: path.join(outDir, "web-ifc-mt.worker.js") },
  ]

  for (const a of assets) copy(a.from, a.to)
  console.log("✅ web-ifc assets copied to public/wasm/")
} catch (e) {
  console.warn("⚠️ Could not copy web-ifc assets:", e && e.message ? e.message : String(e))
}
