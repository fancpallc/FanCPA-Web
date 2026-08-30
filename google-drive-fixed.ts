import { hasOAuthConfig } from './env'
import { getOAuthAccessToken } from './google-oauth'

export interface DriveFolderResult {
  emailFolderId: string
  emailFolderUrl: string
  yearFolderId: string
  yearFolderUrl: string
  source: 'live' | 'stub'
}

async function getDriveAccessToken(env: any): Promise<{ token: string; source: 'live' | 'stub' }> {
  if (hasOAuthConfig(env)) {
    const { accessToken } = await getOAuthAccessToken(env)
    return { token: accessToken, source: 'live' }
  }
  // Fallback SA logic
  const saKey = env?.GCAL_SERVICE_ACCOUNT_KEY || env?.GOOGLE_SERVICE_ACCOUNT_KEY
  if (saKey) {
     // TODO: Implement actual JWT OAuth2 flow with SA key if needed,
     // or assume the caller handles environment appropriately.
     // For now, return stub if no oauth config
  }
  return { token: '', source: 'stub' }
}

export function extractFolderId(url: string): string | null {
  return /\/folders\/([A-Za-z0-9-_]+)/.exec(url)?.[1] || null
}

export async function searchFolder(name: string, parentId: string, token: string): Promise<any | null> {
  const esc = name.replace(/'/g, "\\'")
  const q = `mimeType='application/vnd.google-apps.folder' and name='${esc}' and '${parentId}' in parents and trashed=false`
  try {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    if (!response.ok) return null
  const data = (await response.json()) as { files?: any[] }
  return data.files?.[0] || null
  } catch {
    return null
}
}

export async function createFolder(name: string, parentId: string, token: string): Promise<{ id: string } | null> {
  try {
  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  })
    if (!response.ok) return null
  return (await response.json()) as { id: string }
  } catch {
    return null
}
}

export async function ensurePermission(folderId: string, email: string, token: string, role: string = 'writer'): Promise<void> {
  // List existing permissions to check if already shared
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const data = (await response.json()) as { permissions?: { emailAddress?: string }[] }
  const exists = data.permissions?.some((p: any) => p.emailAddress === email)

  if (!exists) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role,
        type: 'user',
        emailAddress: email
      })
    })
  }
}

export async function ensureClientDriveFolder(
  env: any,
  emailRaw: string,
  yearRaw?: number | string
): Promise<DriveFolderResult> {
  const email = emailRaw.toLowerCase().trim()
  let year = parseInt(String(yearRaw), 10)
  if (isNaN(year) || year < 2000 || year > 2100) {
    year = new Date().getFullYear()
  }

  const isStub = env?.STUB === 'true' || env?.ENVIRONMENT === 'local' || env?.ENVIRONMENT === 'test'

  if (isStub) {
    const safeEmail = email.replace(/[@.]/g, '-')
    const fakeEmailId = `fake-${safeEmail}-${year}`
    const fakeYearId = `fake-${safeEmail}-${year}-year`
    return {
      emailFolderId: fakeEmailId,
      emailFolderUrl: `https://drive.google.com/drive/folders/${fakeEmailId}`,
      yearFolderId: fakeYearId,
      yearFolderUrl: `https://drive.google.com/drive/folders/${fakeYearId}`,
      source: 'stub',
    }
  }

  // Live implementation
  const { token, source } = await getDriveAccessToken(env)
  if (!token) throw new Error('DRIVE_AUTH_FAILED: No access token')

  // Support aliases for root folder
  const rootId = env?.DRIVE_ROOT_FOLDER_ID || env?.GDRIVE_ROOT_FOLDER_ID || env?.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root'
  let emailFolder = await searchFolder(email, rootId, token)
  if (!emailFolder) {
    emailFolder = await createFolder(email, rootId, token)
  }
  if (!emailFolder?.id) throw new Error('DRIVE_ENSURE_FAILED: Could not find or create email folder')
  await ensurePermission(emailFolder.id, email, token)

  let yearFolder = await searchFolder(String(year), emailFolder.id, token)
  if (!yearFolder) {
    yearFolder = await createFolder(String(year), emailFolder.id, token)
  }
  if (!yearFolder?.id) throw new Error('DRIVE_ENSURE_FAILED: Could not find or create year folder')
  await ensurePermission(yearFolder.id, email, token)

  console.log(`!!! CONFIRM_DRIVE_RESULT source=${source} year=${year} link=https://drive.google.com/drive/folders/${yearFolder.id}`)

  return {
    emailFolderId: emailFolder.id,
    emailFolderUrl: `https://drive.google.com/drive/folders/${emailFolder.id}`,
    yearFolderId: yearFolder.id,
    yearFolderUrl: `https://drive.google.com/drive/folders/${yearFolder.id}`,
    source: source,
  }
}

