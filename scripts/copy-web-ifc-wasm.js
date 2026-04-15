const fs = require("fs")
const path = require("path")

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) return false
  fs.copyFileSync(from, to)
  return true
}

function main() {
  const root = path.join(__dirname, "..")
  const destDir = path.join(root, "public", "wasm")
  fs.mkdirSync(destDir, { recursive: true })

  const candidates = [
    path.join(root, "node_modules", "web-ifc", "web-ifc.wasm"),
    path.join(root, "node_modules", "web-ifc", "web-ifc-mt.wasm"),
    path.join(root, "node_modules", "web-ifc", "web-ifc-api.wasm"),
  ]

  for (const src of candidates) {
    const base = path.basename(src)
    const dst = path.join(destDir, base)
    copyIfExists(src, dst)
  }
}

main()

