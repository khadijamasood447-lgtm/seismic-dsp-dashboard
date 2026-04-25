import { IfcParser, extractQuantitiesOnDemand, type IfcDataStore } from "@ifc-lite/parser"

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
  lite_summary?: {
    warnings: string[]
    location: { lat: number; lon: number } | null
    building: { name?: string; height_m?: number | null } | null
    counts: { columns: number; beams: number; footings: number; walls: number } | null
    materials: string[]
  }
}

function getIds(store: IfcDataStore, keys: string[]) {
  for (const k of keys) {
    const ids = store.entityIndex.byType.get(k)
    if (Array.isArray(ids)) return ids
  }
  return [] as number[]
}

function computeTotalFloorAreaFromSpaces(store: IfcDataStore) {
  const spaceIds = getIds(store, ["IFCSPACE", "IfcSpace"])
  let total = 0
  let foundAny = false

  for (const id of spaceIds) {
    const qsets = extractQuantitiesOnDemand(store, id)
    for (const qs of qsets) {
      for (const q of qs.quantities) {
        const name = String(q.name ?? "").toLowerCase()
        const isAreaLike = name.includes("gross") || name.includes("net") || name.includes("floor") || name.includes("area")
        if (!isAreaLike) continue
        const v = Number(q.value)
        if (!Number.isFinite(v) || v <= 0) continue
        total += v
        foundAny = true
      }
    }
  }

  return foundAny ? total : null
}

export async function extractIfcForChat(args: { buffer: ArrayBuffer; file_name?: string; source_url?: string }): Promise<IfcExtractedChatData> {
  const parser = new IfcParser()
  const store = await parser.parseColumnar(args.buffer)

  const byType: Record<string, number> = {}
  const typeKeys: Array<[string, string[]]> = [
    ["IFCWALL", ["IFCWALL", "IFCWALLSTANDARDCASE", "IfcWall", "IfcWallStandardCase"]],
    ["IFCSLAB", ["IFCSLAB", "IfcSlab"]],
    ["IFCDOOR", ["IFCDOOR", "IfcDoor"]],
    ["IFCWINDOW", ["IFCWINDOW", "IfcWindow"]],
    ["IFCCOLUMN", ["IFCCOLUMN", "IfcColumn"]],
    ["IFCBEAM", ["IFCBEAM", "IfcBeam"]],
    ["IFCFOOTING", ["IFCFOOTING", "IfcFooting"]],
    ["IFCSPACE", ["IFCSPACE", "IfcSpace"]],
    ["IFCBUILDINGSTOREY", ["IFCBUILDINGSTOREY", "IfcBuildingStorey"]],
  ]

  let total = 0
  for (const [label, keys] of typeKeys) {
    const ids = getIds(store, keys)
    byType[label] = ids.length
    total += ids.length
  }

  const totalFloorArea = computeTotalFloorAreaFromSpaces(store)

  const warnings: string[] = []
  if (store.fileSize >= 50 * 1024 * 1024) warnings.push(`Large IFC file (${(store.fileSize / 1_048_576).toFixed(1)} MB). Extraction may take longer.`)

  return {
    schema: "ifc-extract-v1",
    file_name: args.file_name,
    source_url: args.source_url,
    stats: { total_elements: total, by_type: byType },
    quantities: { total_floor_area_m2: totalFloorArea },
    lite_summary: {
      warnings,
      location: null,
      building: null,
      counts: {
        columns: byType.IFCCOLUMN ?? 0,
        beams: byType.IFCBEAM ?? 0,
        footings: byType.IFCFOOTING ?? 0,
        walls: byType.IFCWALL ?? 0,
      },
      materials: [],
    },
  }
}
