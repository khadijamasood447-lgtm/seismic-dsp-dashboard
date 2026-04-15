import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { listFilesInFolder } from '@/lib/google-drive'

export async function GET() {
  try {
    const folderId = requireEnv('DRIVE_FOLDER_ID')
    const files = await listFilesInFolder(folderId)
    return NextResponse.json({
      ok: true,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
      })),
    })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
