import { createRequire } from 'module'
import path from 'path'
import fs from 'fs/promises'

export const runtime = 'nodejs'

const require = createRequire(import.meta.url)

const ALLOWED = new Set(['web-ifc.wasm', 'web-ifc-mt.wasm', 'web-ifc-mt.worker.js'])

function contentTypeFor(name: string) {
  if (name.endsWith('.wasm')) return 'application/wasm'
  if (name.endsWith('.js')) return 'application/javascript; charset=utf-8'
  return 'application/octet-stream'
}

export async function GET(_req: Request, ctx: { params: { file: string } }) {
  const file = String(ctx?.params?.file ?? '')
  if (!ALLOWED.has(file)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const pkgDir = path.dirname(require.resolve('web-ifc'))
    const filePath = path.join(pkgDir, file)
    const buf = await fs.readFile(filePath)
    return new Response(buf, {
      headers: {
        'content-type': contentTypeFor(file),
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

