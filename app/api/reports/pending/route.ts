import { NextResponse } from 'next/server'
import { getDbPool } from '@/lib/db'
import { getUserIdFromHeaders } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const pool = getDbPool()

export async function GET(req: Request) {
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

    const result = await pool.query(
      `SELECT r.*, p.email as user_email 
       FROM public.reports r
       JOIN public.profiles p ON r.user_id = p.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at DESC`
    )

    return NextResponse.json({ ok: true, reports: result.rows })

  } catch (error: any) {
    console.error('Pending reports error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
