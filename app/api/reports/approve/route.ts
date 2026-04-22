import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { getUserIdFromHeaders } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

export async function POST(req: Request) {
  try {
    const userId = getUserIdFromHeaders(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is authority
    const userProfile = await pool.query(
      'SELECT role FROM public.profiles WHERE id = $1',
      [userId]
    )

    const role = userProfile.rows[0]?.role
    if (!['authority', 'admin'].includes(role)) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const { reportId, status, comments, checklist } = await req.json()

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 })
    }

    // Update report status
    const result = await pool.query(
      `UPDATE public.reports 
       SET status = $1, 
           reviewer_id = $2, 
           reviewer_comments = $3, 
           compliance_checklist = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [status, userId, comments, checklist, reportId]
    )

    if (result.rowCount === 0) {
      return NextResponse.json({ ok: false, error: 'Report not found' }, { status: 404 })
    }

    // Notify the engineer
    await pool.query(
      `INSERT INTO public.notifications (user_id, type, message, application_id)
       VALUES ($1, 'report_status_update', $2, $3)`,
      [result.rows[0].user_id, `Your report "${result.rows[0].report_title}" has been ${status}.`, reportId]
    )

    return NextResponse.json({ ok: true, report: result.rows[0] })

  } catch (error: any) {
    console.error('Report approval error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
