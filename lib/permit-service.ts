import crypto from 'crypto'

import { parseIfcLite } from '@/lib/ifc-lite'
import { sampleIslamabadGrid } from '@/lib/islamabadGrid'
import { queryNearest } from '@/lib/vs-data'
import { createPermitAdminClient } from '@/lib/permit-supabase'

function siteClassFromVs30(vs30: number | null) {
  if (typeof vs30 !== 'number' || !Number.isFinite(vs30)) return null
  if (vs30 > 1500) return 'A'
  if (vs30 > 760) return 'B'
  if (vs30 > 360) return 'C'
  if (vs30 > 180) return 'D'
  return 'E'
}

function makeApplicationNumber() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase()
  return `APP-${y}${m}${day}-${rand}`
}

export async function submitPermitApplication(params: {
  engineer_id: string
  file_name: string
  file_bytes: Uint8Array
  location?: { lat: number; lon: number } | null
  engineer_notes?: string | null
}) {
  const admin = createPermitAdminClient()
  const applicationNumber = makeApplicationNumber()

  const ifcText = Buffer.from(params.file_bytes).toString('utf-8')
  const parsed = parseIfcLite(ifcText)
  const loc = params.location ?? parsed.location

  let siteClass: string | null = null
  let vsPredictions: any = null
  let geo: any = null
  if (loc) {
    const grid = await sampleIslamabadGrid(loc.lon, loc.lat)
    geo = grid
    const vs30 = typeof grid.layers?.vs30 === 'number' ? grid.layers.vs30 : null
    siteClass = siteClassFromVs30(vs30)
    const depths = [1, 2, 3, 5]
    vsPredictions = depths.map((d) => {
      const row = queryNearest(loc.lon, loc.lat, d)
      return row
        ? { depth_m: d, vs: row.vs_predicted_m_s, p10: row.vs_predicted_p10, p90: row.vs_predicted_p90 }
        : { depth_m: d, vs: null, p10: null, p90: null }
    })
  }

  const bucket = 'ifc_uploads'
  const objectPath = `permit/${params.engineer_id}/${applicationNumber}_${params.file_name}`
  const upload = await admin.storage.from(bucket).upload(objectPath, params.file_bytes, {
    contentType: 'application/octet-stream',
    upsert: true,
  })
  if (upload.error) throw upload.error

  const signed = await admin.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 7)
  const ifcUrl = signed.data?.signedUrl ?? null

  const geom = loc ? `SRID=4326;POINT(${loc.lon} ${loc.lat})` : null
  const { data, error } = await admin
    .from('permit_applications')
    .insert({
      application_number: applicationNumber,
      engineer_id: params.engineer_id,
      ifc_file_url: ifcUrl,
      building_location: geom,
      site_class: siteClass,
      vs_predictions: vsPredictions,
      status: 'pending',
      reviewer_comments: null,
      approved_conditions: null,
    })
    .select('*')
    .single()
  if (error) throw error

  return {
    application: data,
    parsed_ifc: parsed,
    site_conditions: geo,
  }
}

export async function listPermitApplications(params: { user_id: string; role: string | null }) {
  const admin = createPermitAdminClient()
  const role = (params.role ?? '').toLowerCase()
  if (role.startsWith('authority') || role === 'reviewer' || role === 'admin') {
    const { data, error } = await admin.from('permit_applications').select('*').order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    return data ?? []
  }
  const { data, error } = await admin
    .from('permit_applications')
    .select('*')
    .eq('engineer_id', params.user_id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data ?? []
}

export async function getPermitApplication(id: string) {
  const admin = createPermitAdminClient()
  const { data, error } = await admin.from('permit_applications').select('*').eq('id', id).single()
  if (error) throw error
  const { data: reviews, error: e2 } = await admin.from('permit_reviews').select('*').eq('application_id', id).order('reviewed_at', { ascending: false })
  if (e2) throw e2
  return { application: data, reviews: reviews ?? [] }
}

export async function submitPermitReview(params: {
  application_id: string
  reviewer_id: string
  decision: 'approved' | 'rejected' | 'needs_revision'
  comments?: string | null
  code_sections_cited?: any
  approved_conditions?: any
}) {
  const admin = createPermitAdminClient()
  const status =
    params.decision === 'approved' ? 'approved' : params.decision === 'rejected' ? 'rejected' : 'needs_revision'

  const { data: app, error: aerr } = await admin.from('permit_applications').select('*').eq('id', params.application_id).single()
  if (aerr) throw aerr

  const { error: rerr } = await admin.from('permit_reviews').insert({
    application_id: params.application_id,
    reviewer_id: params.reviewer_id,
    decision: params.decision,
    comments: params.comments ?? null,
    code_sections_cited: params.code_sections_cited ?? null,
  })
  if (rerr) throw rerr

  const { error: uerr } = await admin
    .from('permit_applications')
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewer_id: params.reviewer_id,
      reviewer_comments: params.comments ?? null,
      approved_conditions: params.approved_conditions ?? null,
    })
    .eq('id', params.application_id)
  if (uerr) throw uerr

  return { application: app }
}
