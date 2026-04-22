import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getUserIdFromHeaders } from '@/lib/supabase/server'
import { getDbPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

export async function POST(req: Request) {
  try {
    const userId = getUserIdFromHeaders(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    const reportTitle = formData.get('title') as string
    const buildingType = formData.get('buildingType') as string
    const location = formData.get('location') as string

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file uploaded' }, { status: 400 })
    }

    // 1. Upload to Supabase Storage
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const fileName = `${userId}/${Date.now()}-${file.name}`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('reports')
      .upload(fileName, file)

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage
      .from('reports')
      .getPublicUrl(fileName)

    // 2. Save to database
    const result = await pool.query(
      `INSERT INTO public.reports (
        user_id, report_title, building_type, location, report_pdf_url, file_size_bytes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, reportTitle, buildingType, location, publicUrl, file.size, 'pending']
    )

    // 3. Notify CDA (authority)
    await pool.query(
      `INSERT INTO public.notifications (user_id, type, message, application_id)
       SELECT id, 'report_submitted', $1, $2
       FROM public.profiles 
       WHERE role IN ('authority', 'admin')`,
      [`New report submitted: ${reportTitle}`, result.rows[0].id]
    )

    return NextResponse.json({ ok: true, report: result.rows[0] })

  } catch (error: any) {
    console.error('Report upload error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
