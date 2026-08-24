import { hasOAuthConfig, getDriveRootFolderId } from './env'
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
  // Try Service Account fallback if configured
  const saKey = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY || env.DRIVE_SERVICE_ACCOUNT_KEY || env.GCAL_SERVICE_ACCOUNT_KEY
  if (saKey) {
    // In a real implementation, you'd exchange this for a token.
    // For now, return stub.
  return { token: '', source: 'stub' }
}
  return { token: '', source: 'stub' }
}

export function extractFolderId(url: string): string | null {
  return /\/folders\/([A-Za-z0-9-_]+)/.exec(url)?.[1] || null
}

export async function searchFolder(name: string, parentId: string, token: string): Promise<any | null> {
  const escaped = name.replace(/'/g, "\\'")
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and '${parentId}' in parents and trashed=false`
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
  try {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    if (!response.ok) {
      console.error(`Failed to list permissions for folder ${folderId}: ${response.statusText}`)
      return
    }
    const data = (await response.json()) as { permissions?: { emailAddress?: string; role?: string }[] }
  const exists = data.permissions?.some((p: any) => p.emailAddress === email)

  if (!exists) {
      const shareResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
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
      if (!shareResponse.ok) {
        console.error(`Failed to share folder ${folderId} with ${email}: ${shareResponse.statusText}`)
  }
}
  } catch (error) {
    console.error(`Error in ensurePermission for folder ${folderId}:`, error)
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
  if (source === 'stub') {
    console.log(`[DRIVE] Using stub for ${email}`)
    return {
      emailFolderId: 'stub-folder',
      emailFolderUrl: 'https://drive.google.com/drive/folders/stub-folder',
      yearFolderId: 'stub-folder',
      yearFolderUrl: 'https://drive.google.com/drive/folders/stub-folder',
      source: 'stub'
    }
  }

  const rootId = getDriveRootFolderId(env) || 'root'
  console.log(`[DRIVE] Ensuring folders for ${email} in root ${rootId}`)

  let emailFolder = await searchFolder(email, rootId, token)
  if (!emailFolder) {
    emailFolder = await createFolder(email, rootId, token)
  }
  if (!emailFolder || !emailFolder.id) throw new Error('Failed to ensure email folder')
  await ensurePermission(emailFolder.id, email, token)

  let yearFolder = await searchFolder(String(year), emailFolder.id, token)
  if (!yearFolder) {
    yearFolder = await createFolder(String(year), emailFolder.id, token)
  }
  if (!yearFolder || !yearFolder.id) throw new Error('Failed to ensure year folder')
  await ensurePermission(yearFolder.id, email, token)
  return {
    emailFolderId: emailFolder.id,
    emailFolderUrl: `https://drive.google.com/drive/folders/${emailFolder.id}`,
    yearFolderId: yearFolder.id,
    yearFolderUrl: `https://drive.google.com/drive/folders/${yearFolder.id}`,
    source: 'live',
  }
}

