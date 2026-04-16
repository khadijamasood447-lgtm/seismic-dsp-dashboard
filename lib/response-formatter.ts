/**
 * Format comparison data as readable text table instead of JSON
 */
export function formatComparisonAsText(data: {
  a?: any
  b?: any
  depth_m?: number
}): string {
  if (!data.a || !data.b) return "Unable to compare sectors - missing data"

  const a = data.a
  const b = data.b
  const depth = data.depth_m || 2.0

  // Extract key metrics
  const getMetrics = (sector: any) => ({
    sector: sector?.sector_norm || "Unknown",
    vs: sector?.vs_mean ? sector.vs_mean.toFixed(1) : "N/A",
    p10: sector?.vs_p10_mean ? sector.vs_p10_mean.toFixed(1) : "N/A",
    p90: sector?.vs_p90_mean ? sector.vs_p90_mean.toFixed(1) : "N/A",
    std: sector?.vs_pred_std ? sector.vs_pred_std.toFixed(1) : "N/A",
  })

  const metricsA = getMetrics(a)
  const metricsB = getMetrics(b)

  // Format as table
  const lines = [
    `\n📊 COMPARISON AT ${depth}m DEPTH`,
    `════════════════════════════════════════════════`,
    ``,
    `METRIC              │ ${metricsA.sector.padEnd(12)} │ ${metricsB.sector.padEnd(12)} │ DIFFERENCE`,
    `────────────────────┼──────────────┼──────────────┼──────────────`,
    `Vs Mean (m/s)       │ ${metricsA.vs.padStart(12)} │ ${metricsB.vs.padStart(12)} │ ${(parseFloat(metricsB.vs) - parseFloat(metricsA.vs)).toFixed(1).padStart(12)}`,
    `Vs P10 (m/s)        │ ${metricsA.p10.padStart(12)} │ ${metricsB.p10.padStart(12)} │ ${(parseFloat(metricsB.p10) - parseFloat(metricsA.p10)).toFixed(1).padStart(12)}`,
    `Vs P90 (m/s)        │ ${metricsA.p90.padStart(12)} │ ${metricsB.p90.padStart(12)} │ ${(parseFloat(metricsB.p90) - parseFloat(metricsA.p90)).toFixed(1).padStart(12)}`,
    `Std Dev (m/s)       │ ${metricsA.std.padStart(12)} │ ${metricsB.std.padStart(12)} │ ${(parseFloat(metricsB.std) - parseFloat(metricsA.std)).toFixed(1).padStart(12)}`,
    `════════════════════════════════════════════════`,
  ]

  // Add interpretation
  const vsDiff = parseFloat(metricsB.vs) - parseFloat(metricsA.vs)
  lines.push(``)
  lines.push(`KEY FINDINGS:`)

  if (Math.abs(vsDiff) < 50) {
    lines.push(`• Vs values are SIMILAR (difference: ${vsDiff.toFixed(1)} m/s)`)
  } else if (vsDiff > 0) {
    lines.push(`• ${metricsB.sector} has HIGHER Vs (+${vsDiff.toFixed(1)} m/s) → stiffer/more stable soil`)
  } else {
    lines.push(`• ${metricsA.sector} has HIGHER Vs (+${Math.abs(vsDiff).toFixed(1)} m/s) → stiffer/more stable soil`)
  }

  lines.push(
    `• Uncertainty range: ${metricsA.sector} [${metricsA.p10}-${metricsA.p90} m/s], ${metricsB.sector} [${metricsB.p10}-${metricsB.p90} m/s]`,
  )
  lines.push(`• These are research-grade predictions for screening purposes only`)
  lines.push(``)

  return lines.join("\n")
}

/**
 * Format soil composition data as text table
 */
export function formatSoilCompositionAsText(data: {
  sector?: string
  sand?: number
  silt?: number
  clay?: number
  moisture?: number
  bulk_density?: number
}): string {
  if (!data) return "No soil composition data available"

  const lines = [
    ``,
    `🌍 SOIL COMPOSITION - ${data.sector || "Location"}`,
    `════════════════════════════════════════`,
    `Property                Value`,
    `────────────────────────────────────────`,
    `Sand Content          ${(data.sand || 0).toFixed(1)}%`,
    `Silt Content          ${(data.silt || 0).toFixed(1)}%`,
    `Clay Content          ${(data.clay || 0).toFixed(1)}%`,
    `Moisture Content      ${(data.moisture || 0).toFixed(1)}%`,
    `Bulk Density          ${(data.bulk_density || 0).toFixed(2)} g/cm³`,
    `════════════════════════════════════════`,
  ]

  // Geotechnical interpretation
  const clay = data.clay || 0
  const sand = data.sand || 0
  const silt = data.silt || 0

  lines.push(``)
  lines.push(`INTERPRETATION:`)

  if (clay < 5) {
    lines.push(`• Very LOW clay content - primarily sandy/silty soil`)
    lines.push(`• Expected behavior: Low cohesion, good drainage`)
  } else if (clay < 15) {
    lines.push(`• MODERATE clay content - mixed soil type`)
    lines.push(`• Expected behavior: Some cohesion, variable drainage`)
  } else if (clay < 30) {
    lines.push(`• ELEVATED clay content - clayey soil`)
    lines.push(`• Expected behavior: Higher cohesion, lower permeability`)
  } else {
    lines.push(`• HIGH clay content - predominantly clayey soil`)
    lines.push(`• Expected behavior: Very cohesive, low drainage, swelling potential`)
  }

  if (sand > 50) {
    lines.push(`• Sand-dominant composition → susceptible to liquefaction if saturated`)
  }

  if (data.moisture && data.moisture > 20) {
    lines.push(`• HIGH moisture content → potential for consolidation settlement`)
  }

  lines.push(``)

  return lines.join("\n")
}

/**
 * Format location/nearest data as text
 */
export function formatLocationDataAsText(data: {
  input?: { lon: number; lat: number; depth_m: number }
  nearest?: { lon: number; lat: number; sector: string }
  vs?: number
  p10?: number
  p90?: number
}): string {
  if (!data) return "No location data available"

  const lines = [
    ``,
    `📍 LOCATION ANALYSIS`,
    `════════════════════════════════════════════════`,
    `Query Coordinates     Lat: ${data.input?.lat?.toFixed(4)}, Lon: ${data.input?.lon?.toFixed(4)}`,
    `Query Depth           ${data.input?.depth_m?.toFixed(1)}m`,
    ``,
    `Nearest Grid Point    Lat: ${data.nearest?.lat?.toFixed(4)}, Lon: ${data.nearest?.lon?.toFixed(4)}`,
    `Sector                ${data.nearest?.sector || "Unknown"}`,
    ``,
    `Vs Prediction         ${data.vs?.toFixed(1)} m/s (P10: ${data.p10?.toFixed(1)}, P90: ${data.p90?.toFixed(1)})`,
    `════════════════════════════════════════════════`,
  ]

  // Classify
  const vs = data.vs || 0
  let siteClass = "D"
  if (vs >= 760) siteClass = "A/B"
  else if (vs >= 360) siteClass = "C"
  else if (vs >= 180) siteClass = "D"
  else siteClass = "E"

  lines.push(``)
  lines.push(`SEISMIC SITE CLASSIFICATION (BCP-SP 2021): Class ${siteClass}`)
  lines.push(``)

  return lines.join("\n")
}
