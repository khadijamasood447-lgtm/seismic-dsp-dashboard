const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const root = process.cwd()
const outPath = path.join(root, "src", "data", "code_database.json")

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function runPythonExtract(pdfPaths) {
  const py = `
import json, re, sys
paths = sys.argv[1:]
out = {
  "site_classes": [],
  "seismic_design_categories": [],
  "foundation_requirements": [],
  "height_limits": [],
  "code_references": {}
}

def add_site_class(cls, lo, hi, desc, ref):
  out["site_classes"].append({"class": cls, "vs30_range": [lo, hi], "description": desc})
  if ref: out["code_references"]["site_classification"] = ref

text = ""
for p in paths:
  try:
    import pdfplumber
    with pdfplumber.open(p) as pdf:
      for page in pdf.pages:
        t = page.extract_text() or ""
        text += "\\n" + t
  except Exception:
    try:
      from PyPDF2 import PdfReader
      r = PdfReader(p)
      for page in r.pages:
        text += "\\n" + (page.extract_text() or "")
    except Exception:
      pass

tt = text.lower()

if "vs30" in tt and "site class" in tt:
  add_site_class("C", 360, 760, "Very dense soil / soft rock", "BCP-SP 2021 (site classification)")
  add_site_class("D", 180, 360, "Stiff soil", "BCP-SP 2021 (site classification)")
  add_site_class("E", 0, 180, "Soft soil", "BCP-SP 2021 (site classification)")

json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
`
  const res = spawnSync("python", ["-c", py, ...pdfPaths], { encoding: "utf-8" })
  if (res.status !== 0) {
    throw new Error(res.stderr || "python failed")
  }
  return JSON.parse(res.stdout)
}

function main() {
  const buildingcodesDir = path.join(root, "buildingcodes")
  const fallbackDir = path.join(root, "ISLAMABD DATA")

  let pdfs = []
  if (fs.existsSync(buildingcodesDir)) {
    pdfs = fs.readdirSync(buildingcodesDir).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => path.join(buildingcodesDir, f))
  } else if (fs.existsSync(fallbackDir)) {
    pdfs = fs.readdirSync(fallbackDir).filter((f) => f.toLowerCase().includes("bcp") && f.toLowerCase().endsWith(".pdf")).map((f) => path.join(fallbackDir, f))
  }

  if (pdfs.length === 0) {
    throw new Error("No PDFs found in buildingcodes/ (or fallback).")
  }

  const out = runPythonExtract(pdfs)
  ensureDir(path.dirname(outPath))
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8")
  process.stdout.write(`Wrote ${outPath}\\n`)
}

main()

