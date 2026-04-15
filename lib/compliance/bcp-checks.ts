import { parseIfcLite } from '@/lib/ifc-lite'

export type ComplianceStatus = 'pass' | 'warning' | 'fail'
export type ComplianceSeverity = 'high' | 'medium' | 'low'

export type FoundationType = 'shallow' | 'deep_piles' | 'raft' | 'unknown'
export type LateralSystem = 'special_moment_frame' | 'ordinary_moment_frame' | 'braced_frame' | 'shear_wall' | 'unknown'
export type SeismicCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export type BuildingParams = {
  file_name?: string | null
  building_name?: string | null
  occupancy?: string | null
  location?: { lat: number; lon: number } | null
  stories_count?: number | null
  height_m?: number | null
  foundation_type?: FoundationType
  lateral_system?: LateralSystem
  concrete_grade_mpa?: number | null
  steel_grade_mpa?: number | null
  declared_seismic_category?: SeismicCategory | null
  element_counts?: { columns: number; beams: number; footings: number; walls: number } | null
  material_labels?: string[]
  warnings?: string[]
}

export type SiteData = {
  location: { lat: number; lon: number }
  pga_g: number
  site_class: 'C' | 'D' | 'E' | 'N/A'
  vs30_m_s: number | null
  vs_by_depth: Array<{ depth_m: number; vs_m_s: number | null; p10?: number | null; p90?: number | null }>
  soil_properties?: {
    sand_pct?: number | null
    silt_pct?: number | null
    clay_pct?: number | null
    bulk_density_g_cm3?: number | null
    water_content_pct?: number | null
  }
}

export type ComplianceFinding = {
  id: string
  category: string
  status: ComplianceStatus
  severity: ComplianceSeverity
  code_section: string
  message: string
  recommendation: string
}

export type ComplianceResult = {
  building: BuildingParams
  site: SiteData
  seismic_category: SeismicCategory
  findings: ComplianceFinding[]
  summary: { pass_count: number; warning_count: number; fail_count: number }
  by_priority: { high: string[]; medium: string[]; low: string[] }
  disclaimer: string
}

function normalizeText(text: string) {
  return text.toUpperCase()
}

function parseFloatSafe(v: any): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function parsePgaScenario(input: any): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  const raw = String(input ?? '').trim().toLowerCase()
  const m = raw.match(/(\d+(?:\.\d+)?)/)
  const n = m ? Number(m[1]) : NaN
  if (!Number.isFinite(n)) return 0.3
  return n > 1 ? n / 100 : n
}

function parseMaterialStrengths(text: string) {
  const out: { concrete: number | null; steel: number | null } = { concrete: null, steel: null }
  const concreteMatches: number[] = []
  const steelMatches: number[] = []

  for (const m of text.matchAll(/\bC\s*([2-9]\d)(?:\s*\/\s*\d+)?\b/gi)) concreteMatches.push(Number(m[1]))
  for (const m of text.matchAll(/\bF'?C\s*[:=]?\s*(\d{2,3})\s*MPA\b/gi)) concreteMatches.push(Number(m[1]))
  for (const m of text.matchAll(/\bCONCRETE[^0-9]{0,12}(\d{2,3})\s*MPA\b/gi)) concreteMatches.push(Number(m[1]))

  for (const m of text.matchAll(/\bFY\s*[:=]?\s*(\d{2,3})\s*MPA\b/gi)) steelMatches.push(Number(m[1]))
  for (const m of text.matchAll(/\bSTEEL[^0-9]{0,12}(\d{2,3})\s*MPA\b/gi)) steelMatches.push(Number(m[1]))
  for (const m of text.matchAll(/\bGRADE\s*(\d{2,3})\b/gi)) steelMatches.push(Number(m[1]))

  if (concreteMatches.length) out.concrete = Math.max(...concreteMatches.filter((n) => n >= 15 && n <= 80))
  if (steelMatches.length) out.steel = Math.max(...steelMatches.filter((n) => n >= 200 && n <= 700))
  return out
}

function extractStoreyElevations(text: string) {
  const elevations: number[] = []
  const lines = Array.from(text.matchAll(/IFCBUILDINGSTOREY\([\s\S]*?\);/gi)).map((m) => m[0])
  for (const ln of lines) {
    const nums = Array.from(ln.matchAll(/(-?\d+(?:\.\d+)?)/g))
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n))
    const guess = nums.length ? nums[nums.length - 1] : null
    if (typeof guess === 'number' && Number.isFinite(guess)) elevations.push(guess)
  }
  return elevations
}

function detectFoundationType(upper: string): FoundationType {
  const hasPile = /\bIFCPILE\(/.test(upper) || /\bPILE\b/.test(upper)
  const hasFooting = /\bIFCFOOTING\(/.test(upper) || /\bFOOTING\b/.test(upper)
  const hasRaft = /\bRAFT\b|\bMAT FOUNDATION\b/.test(upper)
  if (hasPile) return 'deep_piles'
  if (hasRaft) return 'raft'
  if (hasFooting) return 'shallow'
  return 'unknown'
}

function detectLateralSystem(upper: string, counts: BuildingParams['element_counts']): LateralSystem {
  if (/\bSPECIAL MOMENT FRAME\b|\bSMF\b/.test(upper)) return 'special_moment_frame'
  if (/\bBRACED\b|\bBRACE\b/.test(upper)) return 'braced_frame'
  if ((counts?.walls ?? 0) > 0 || /\bSHEAR WALL\b/.test(upper)) return 'shear_wall'
  if ((counts?.columns ?? 0) > 0 && (counts?.beams ?? 0) > 0) return 'ordinary_moment_frame'
  return 'unknown'
}

function detectOccupancy(upper: string) {
  if (/\bHOSPITAL\b/.test(upper)) return 'hospital'
  if (/\bSCHOOL\b/.test(upper)) return 'school'
  if (/\bINDUSTRIAL\b/.test(upper)) return 'industrial'
  if (/\bCOMMERCIAL\b/.test(upper)) return 'commercial'
  if (/\bRESIDENTIAL\b/.test(upper)) return 'residential'
  return null
}

function detectDeclaredSeismicCategory(upper: string): SeismicCategory | null {
  const m = upper.match(/\bSEISMIC(?:\s+DESIGN)?\s+CATEGORY\s*[:=]?\s*([A-F])\b/)
  if (!m) return null
  const c = m[1] as SeismicCategory
  return c
}

export function extractIfcDataFromText(text: string, fileName?: string | null): BuildingParams {
  const parsed = parseIfcLite(text)
  const upper = normalizeText(text)
  const strengths = parseMaterialStrengths(text)
  const elev = extractStoreyElevations(text)
  const stories = elev.length || (upper.match(/\bIFCBUILDINGSTOREY\(/g) ?? []).length || null
  let height = parseFloatSafe(parsed.building?.height_m)
  if (height == null && elev.length >= 2) {
    const h = Math.max(...elev) - Math.min(...elev)
    if (Number.isFinite(h) && h > 0) height = h
  }

  return {
    file_name: fileName ?? null,
    building_name: parsed.building?.name ?? null,
    occupancy: detectOccupancy(upper),
    location: parsed.location ?? null,
    stories_count: stories,
    height_m: height,
    foundation_type: detectFoundationType(upper),
    lateral_system: detectLateralSystem(upper, parsed.counts),
    concrete_grade_mpa: strengths.concrete,
    steel_grade_mpa: strengths.steel,
    declared_seismic_category: detectDeclaredSeismicCategory(upper),
    element_counts: parsed.counts,
    material_labels: parsed.materials ?? [],
    warnings: parsed.warnings ?? [],
  }
}

export async function extractIfcDataFromUrl(ifcUrl: string, fileName?: string | null) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25_000)
  try {
    const res = await fetch(ifcUrl, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Failed to fetch IFC (${res.status})`)
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 25_000_000) throw new Error('IFC file too large for extraction endpoint (25MB limit)')
    const text = new TextDecoder().decode(new Uint8Array(buf))
    return extractIfcDataFromText(text, fileName)
  } finally {
    clearTimeout(t)
  }
}

export function deriveSeismicCategory(siteClass: SiteData['site_class'], pga: number): SeismicCategory {
  const s = siteClass
  if (pga >= 0.4) return s === 'E' ? 'F' : s === 'D' ? 'E' : 'D'
  if (pga >= 0.3) return s === 'E' ? 'F' : s === 'D' ? 'E' : 'D'
  if (pga >= 0.2) return s === 'E' ? 'E' : s === 'D' ? 'D' : 'C'
  return s === 'E' ? 'D' : s === 'D' ? 'C' : 'B'
}

function isDef(cat: SeismicCategory) {
  return cat === 'D' || cat === 'E' || cat === 'F'
}

function addFinding(
  arr: ComplianceFinding[],
  finding: Omit<ComplianceFinding, 'id'> & { id?: string },
) {
  arr.push({
    id: finding.id ?? `${finding.category.toLowerCase().replace(/\s+/g, '_')}_${arr.length + 1}`,
    ...finding,
  })
}

export function checkBcpCompliance(building: BuildingParams, site: SiteData): ComplianceResult {
  const findings: ComplianceFinding[] = []
  const seismicCategory = deriveSeismicCategory(site.site_class, site.pga_g)

  const h = building.height_m
  const hLimit = site.site_class === 'E' ? 15 : site.site_class === 'D' ? 25 : null
  if (hLimit == null) {
    addFinding(findings, {
      category: 'Building Height',
      status: h == null ? 'warning' : 'pass',
      severity: h == null ? 'low' : 'low',
      code_section: 'BCP-SP 2021 Table 6-1',
      message: h == null ? 'Building height could not be extracted from IFC.' : 'No screening height limit triggered for Site Class C.',
      recommendation: h == null ? 'Populate IfcBuildingStorey elevations in IFC for deterministic height checks.' : 'Still verify occupancy and drift limits with full structural design.',
    })
  } else if (h == null) {
    addFinding(findings, {
      category: 'Building Height',
      status: 'warning',
      severity: 'medium',
      code_section: 'BCP-SP 2021 Table 6-1',
      message: `Site Class ${site.site_class} uses screening height limit ${hLimit} m, but IFC height is missing.`,
      recommendation: 'Provide explicit storey elevations or manual height to complete this check.',
    })
  } else if (h > hLimit) {
    addFinding(findings, {
      category: 'Building Height',
      status: 'fail',
      severity: 'high',
      code_section: 'BCP-SP 2021 Table 6-1',
      message: `Extracted height ${h.toFixed(1)} m exceeds screening limit ${hLimit} m for Site Class ${site.site_class}.`,
      recommendation: 'Reduce effective height, revise lateral system, or improve site/foundation strategy after detailed analysis.',
    })
  } else {
    addFinding(findings, {
      category: 'Building Height',
      status: 'pass',
      severity: 'low',
      code_section: 'BCP-SP 2021 Table 6-1',
      message: `Extracted height ${h.toFixed(1)} m is within screening limit ${hLimit} m for Site Class ${site.site_class}.`,
      recommendation: 'Confirm with final design-level checks.',
    })
  }

  const fType = building.foundation_type ?? 'unknown'
  const foundationOk =
    site.site_class === 'E'
      ? fType === 'deep_piles' || fType === 'raft'
      : site.site_class === 'D'
        ? fType === 'deep_piles' || fType === 'raft' || fType === 'shallow'
        : fType !== 'unknown'
  addFinding(findings, {
    category: 'Foundation Type',
    status: foundationOk ? 'pass' : fType === 'unknown' ? 'warning' : 'fail',
    severity: foundationOk ? 'low' : site.site_class === 'E' ? 'high' : 'medium',
    code_section: 'BCP-SP 2021 Section 6.2',
    message: foundationOk
      ? `Foundation type (${fType}) appears acceptable for Site Class ${site.site_class}.`
      : `Foundation type (${fType}) may be unsuitable for Site Class ${site.site_class}.`,
    recommendation:
      site.site_class === 'E'
        ? 'Use deep piles or raft with geotechnical verification and settlement checks.'
        : 'Confirm foundation scheme against soil conditions and structural loads.',
  })

  const declared = building.declared_seismic_category
  addFinding(findings, {
    category: 'Seismic Category',
    status: declared && declared !== seismicCategory ? 'fail' : 'pass',
    severity: declared && declared !== seismicCategory ? 'high' : 'low',
    code_section: 'BCP-SP 2021 Section 6.3.2',
    message: declared
      ? `Declared seismic category is ${declared}; screening category from site class + PGA is ${seismicCategory}.`
      : `Screening seismic category from site class + PGA is ${seismicCategory}.`,
    recommendation:
      declared && declared !== seismicCategory
        ? 'Recompute seismic design category and update structural design basis.'
        : 'Validate with complete hazard and occupancy parameters.',
  })

  const lateral = building.lateral_system ?? 'unknown'
  const lateralOk = !isDef(seismicCategory) || lateral === 'special_moment_frame'
  addFinding(findings, {
    category: 'Lateral System',
    status: lateralOk ? 'pass' : 'fail',
    severity: lateralOk ? 'low' : 'high',
    code_section: 'BCP-SP 2021 Section 6.4',
    message: lateralOk
      ? `Lateral system (${lateral}) is acceptable for seismic category ${seismicCategory} at screening level.`
      : `Seismic category ${seismicCategory} requires special moment frame at screening level; detected system is ${lateral}.`,
    recommendation: lateralOk ? 'Confirm detailing in final drawings.' : 'Upgrade to special moment frame system with required seismic detailing.',
  })

  const fc = building.concrete_grade_mpa
  const needsHighMat = isDef(seismicCategory)
  const concretePass = !needsHighMat || (fc != null && fc >= 28)
  addFinding(findings, {
    category: 'Concrete Grade',
    status: concretePass ? 'pass' : fc == null ? 'warning' : 'fail',
    severity: concretePass ? 'low' : 'medium',
    code_section: 'BCP-SP 2021 Section 5.3',
    message:
      fc == null
        ? 'Concrete strength was not found in IFC material/property text.'
        : `Detected concrete grade f'c = ${fc} MPa.`,
    recommendation: concretePass ? 'Keep design mix controls in QA/QC plan.' : "For Seismic Category D/E/F, use minimum f'c = 28 MPa.",
  })

  const fy = building.steel_grade_mpa
  const steelPass = !needsHighMat || (fy != null && fy >= 345)
  addFinding(findings, {
    category: 'Steel Grade',
    status: steelPass ? 'pass' : fy == null ? 'warning' : 'fail',
    severity: steelPass ? 'low' : 'medium',
    code_section: 'BCP-SP 2021 Section 5.4',
    message: fy == null ? 'Steel yield strength (Fy) not found in IFC material/property text.' : `Detected steel grade Fy = ${fy} MPa.`,
    recommendation: steelPass ? 'Confirm ductility class and welding specs.' : 'For Seismic Category D/E/F, use minimum Fy = 345 MPa.',
  })

  const specialInspectionTagged =
    /SPECIAL\s+INSPECTION|SEISMIC\s+INSPECTION|QUALITY\s+ASSURANCE/i.test((building.material_labels ?? []).join(' ')) ||
    false
  const inspectionPass = !needsHighMat ? true : specialInspectionTagged
  addFinding(findings, {
    category: 'Special Inspection',
    status: inspectionPass ? 'pass' : 'fail',
    severity: inspectionPass ? 'low' : 'medium',
    code_section: 'BCP-SP 2021 Section 17',
    message: inspectionPass
      ? 'Special inspection requirement appears addressed in available metadata.'
      : `Seismic category ${seismicCategory} requires special inspection; no explicit inspection metadata was detected.`,
    recommendation: inspectionPass ? 'Maintain inspection records in permit workflow.' : 'Add special inspection plan and checklist before authority approval.',
  })

  const summary = {
    pass_count: findings.filter((f) => f.status === 'pass').length,
    warning_count: findings.filter((f) => f.status === 'warning').length,
    fail_count: findings.filter((f) => f.status === 'fail').length,
  }

  const by_priority = {
    high: findings.filter((f) => f.severity === 'high' && f.status !== 'pass').map((f) => f.recommendation),
    medium: findings.filter((f) => f.severity === 'medium' && f.status !== 'pass').map((f) => f.recommendation),
    low: findings.filter((f) => f.severity === 'low' && f.status !== 'pass').map((f) => f.recommendation),
  }

  return {
    building,
    site,
    seismic_category: seismicCategory,
    findings,
    summary,
    by_priority,
    disclaimer:
      'PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. This screening uses limited IFC extraction and shallow Vs predictions; verify with site-specific investigation and licensed engineer review.',
  }
}

