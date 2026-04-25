import { IfcAPI, IFCSLAB, IFCWALL, IFCWALLSTANDARDCASE, IFCDOOR, IFCWINDOW, IFCCOLUMN, IFCBEAM, IFCSPACE, IFCBUILDINGSTOREY } from "web-ifc"

export type IfcExtractedChatData = {
  schema: "ifc-extract-v1"
  file_name?: string
  source_url?: string
  stats: {
    total_elements: number
    by_type: Record<string, number>
  }
  quantities: {
    total_floor_area_m2: number | null
  }
}

function toRefValue(v: any): number | null {
  if (!v) return null
  if (typeof v === "number") return v
  if (typeof v === "object" && typeof v.value === "number") return v.value
  return null
}

function safeName(v: any): string | null {
  const n = v?.value ?? v
  return typeof n === "string" ? n : null
}

function numValue(v: any): number | null {
  const n = v?.value ?? v
  return typeof n === "number" && Number.isFinite(n) ? n : null
}

async function initIfcApi() {
  const api = new IfcAPI()
  api.SetWasmPath("/wasm/", true)
  await api.Init()
  return api
}

function countByType(api: IfcAPI, modelID: number) {
  const types: Array<[number, string]> = [
    [IFCWALL, "IFCWALL"],
    [IFCWALLSTANDARDCASE, "IFCWALLSTANDARDCASE"],
    [IFCSLAB, "IFCSLAB"],
    [IFCDOOR, "IFCDOOR"],
    [IFCWINDOW, "IFCWINDOW"],
    [IFCCOLUMN, "IFCCOLUMN"],
    [IFCBEAM, "IFCBEAM"],
    [IFCSPACE, "IFCSPACE"],
    [IFCBUILDINGSTOREY, "IFCBUILDINGSTOREY"],
  ]

  const byType: Record<string, number> = {}
  let total = 0
  for (const [t, name] of types) {
    const ids = api.GetLineIDsWithType(modelID, t)
    byType[name] = ids?.size?.() ? ids.size() : 0
    total += byType[name] || 0
  }
  return { byType, total }
}

function extractTotalFloorAreaFromSpaces(api: IfcAPI, modelID: number) {
  const spaceIDs = api.GetLineIDsWithType(modelID, IFCSPACE)
  const ids: number[] = []
  if (spaceIDs?.size?.()) for (let i = 0; i < spaceIDs.size(); i++) ids.push(spaceIDs.get(i))

  let total = 0
  let foundAny = false

  for (const id of ids) {
    const space: any = api.GetLine(modelID, id, false)
    const isDefinedBy: any[] = Array.isArray(space?.IsDefinedBy) ? space.IsDefinedBy : []
    for (const relRef of isDefinedBy) {
      const relId = toRefValue(relRef)
      if (!relId) continue
      const rel: any = api.GetLine(modelID, relId, false)
      const propDefId = toRefValue(rel?.RelatingPropertyDefinition)
      if (!propDefId) continue
      const propDef: any = api.GetLine(modelID, propDefId, false)

      const quantities: any[] = Array.isArray(propDef?.Quantities) ? propDef.Quantities : []
      for (const qRef of quantities) {
        const qId = toRefValue(qRef)
        if (!qId) continue
        const q: any = api.GetLine(modelID, qId, false)
        const qName = (safeName(q?.Name) || "").toLowerCase()
        const isAreaLike =
          qName.includes("grossfloorarea") ||
          qName.includes("netfloorarea") ||
          qName.includes("floorarea") ||
          qName.includes("area")
        if (!isAreaLike) continue

        const area = numValue(q?.AreaValue) ?? numValue(q?.NominalValue) ?? numValue(q?.LengthValue)
        if (area == null) continue
        total += area
        foundAny = true
      }
    }
  }

  return foundAny ? total : null
}

export async function extractIfcForChat(args: { buffer: ArrayBuffer; file_name?: string; source_url?: string }): Promise<IfcExtractedChatData> {
  const api = await initIfcApi()
  let modelID = -1
  try {
    const data = new Uint8Array(args.buffer)
    modelID = api.OpenModel(data)

    const { byType, total } = countByType(api, modelID)
    const totalFloorArea = extractTotalFloorAreaFromSpaces(api, modelID)

    return {
      schema: "ifc-extract-v1",
      file_name: args.file_name,
      source_url: args.source_url,
      stats: { total_elements: total, by_type: byType },
      quantities: { total_floor_area_m2: totalFloorArea },
    }
  } finally {
    if (modelID >= 0) {
      try {
        api.CloseModel(modelID)
      } catch {}
    }
    try {
      api.Dispose()
    } catch {}
  }
}
