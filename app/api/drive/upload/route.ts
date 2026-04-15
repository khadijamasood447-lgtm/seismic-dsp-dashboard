import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { uploadFileToFolder } from '@/lib/google-drive'
import mime from 'mime-types'

export async function POST(request: Request) {
  try {
    const folderId = requireEnv('DRIVE_FOLDER_ID')
    const form = await request.formData()
    const file = form.get('file')
    const nameOverride = form.get('name')

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const data = Buffer.from(arrayBuffer)
    const name = typeof nameOverride === 'string' && nameOverride.length > 0 ? nameOverride : file.name
    const guessed = mime.lookup(name) || file.type || 'application/octet-stream'

    const res = await uploadFileToFolder({
      folderId,
      name,
      mimeType: typeof guessed === 'string' ? guessed : 'application/octet-stream',
      data,
    })

    return NextResponse.json({ ok: true, file: res })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
