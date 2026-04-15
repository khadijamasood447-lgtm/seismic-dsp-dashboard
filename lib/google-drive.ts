
import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { requireEnv } from '@/lib/env'

function getOAuthClient(): OAuth2Client {
  const clientId = requireEnv('GOOGLE_CLIENT_ID')
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET')
  const redirectUri = requireEnv('GOOGLE_REDIRECT_URI')
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN')

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  oauth2.setCredentials({ refresh_token: refreshToken })
  return oauth2
}

function getDrive() {
  const auth = getOAuthClient()
  return google.drive({ version: 'v3', auth })
}

export async function listFilesInFolder(folderId: string) {
  const drive = getDrive()
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime)',
    pageSize: 100,
  })
  return res.data.files ?? []
}

export async function uploadFileToFolder(params: { folderId: string; name: string; mimeType: string; data: Buffer }) {
  const drive = getDrive()
  const res = await drive.files.create({
    requestBody: {
      name: params.name,
      parents: [params.folderId],
      mimeType: params.mimeType,
    },
    media: {
      mimeType: params.mimeType,
      body: Buffer.from(params.data),
    },
    fields: 'id, name',
  })
  return res.data
}
