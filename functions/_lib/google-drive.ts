import { getDriveRootFolderId, getDriveOwnerEmail, hasOAuthConfig, getEffectiveDriveRootFolderId } from './env'
import { getOAuthAccessToken } from './google-oauth'

export interface DriveFolderResult {
  emailFolderId: string
  emailFolderUrl: string
  yearFolderId: string
  yearFolderUrl: string
  source: 'live' | 'stub'
  error?: string
}

export async function getDriveAccessToken(env: any): Promise<{ token: string; source: 'live' | 'stub'; error?: string }> {
  if (hasOAuthConfig(env)) {
    const { accessToken, error } = await getOAuthAccessToken(env)
    if (accessToken) return { token: accessToken, source: 'live' }
    // OAuth configured but token exchange failed — caller must treat as live error, not silent stub
    return { token: '', source: 'stub', error: error || 'OAuth token exchange failed' }
  }
  return { token: '', source: 'stub' }
}

export function extractFolderId(url: string): string | null {
  return /\/folders\/([A-Za-z0-9-_]+)/.exec(url)?.[1] || null
}

export async function searchFolder(name: string, parentId: string, token: string): Promise<any | null> {
  try {
    const escaped = name.replace(/'/g, "\\'")
    const q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and '${parentId}' in parents and trashed=false`
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    })
    if (!response.ok) return null
    return (await response.json()) as { id: string }
  } catch {
    return null
  }
}

export async function ensurePermission(
  folderId: string,
  email: string,
  token: string,
  role: string = 'writer',
  ownerEmail?: string
): Promise<{ alreadyShared: boolean; skippedOwner?: boolean }> {
  try {
    // Skip if sharing with the owner — Drive returns 400 for owner-share
    if (ownerEmail && email.toLowerCase() === ownerEmail.toLowerCase()) {
      return { alreadyShared: true, skippedOwner: true }
    }
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!listRes.ok) {
      // Non-fatal: folder may be inaccessible; don't crash the whole ensure flow
      console.log(`!!! DRIVE_PERMISSION_LIST_FAILED folderId=${folderId} status=${listRes.status}`)
      return { alreadyShared: false }
    }
    const data = (await listRes.json()) as { permissions?: { emailAddress?: string }[] }
    const exists = data.permissions?.some((p: any) => p.emailAddress?.toLowerCase() === email.toLowerCase())
    if (exists) return { alreadyShared: true }

    const createRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role, type: 'user', emailAddress: email }),
    })
    if (!createRes.ok) {
      console.log(`!!! DRIVE_PERMISSION_CREATE_FAILED folderId=${folderId} email=${email} status=${createRes.status}`)
    }
    return { alreadyShared: false }
  } catch (e: any) {
    console.log(`!!! DRIVE_PERMISSION_EXCEPTION folderId=${folderId} ${e?.message}`)
    return { alreadyShared: false }
  }
}

export async function ensureClientDriveFolder(
  env: any,
  emailRaw: string,
  yearRaw?: number | string,
  opts?: { parentFolderId?: string; db?: any }
): Promise<DriveFolderResult> {
  const email = emailRaw.toLowerCase().trim()
  let year = parseInt(String(yearRaw), 10)
  if (isNaN(year) || year < 2000 || year > 2100) {
    year = new Date().getFullYear()
  }

  const hasCreds = hasOAuthConfig(env)
  const isStub =
    env?.STUB === 'true' ||
    env?.ENVIRONMENT === 'local' ||
    env?.ENVIRONMENT === 'test' ||
    !hasCreds

  if (isStub) {
    const safeEmail = email.replace(/[@.]/g, '-')
    // L8 fix: email folder id is stable across years so reuse can be detected; year only in year id
    const fakeEmailId = `fake-${safeEmail}`
    const fakeYearId = `fake-${safeEmail}-${year}`
    return {
      emailFolderId: fakeEmailId,
      emailFolderUrl: `https://drive.google.com/drive/folders/${fakeEmailId}`,
      yearFolderId: fakeYearId,
      yearFolderUrl: `https://drive.google.com/drive/folders/${fakeYearId}`,
      source: 'stub',
    }
  }

  // Live path — if OAuth creds exist, a token failure must be fatal, not a silent fake URL
  const { token, source, error: tokenError } = await getDriveAccessToken(env)
  if (source === 'stub' || !token) {
    const isLiveEnv = hasCreds && env?.ENVIRONMENT !== 'local' && env?.ENVIRONMENT !== 'test' && env?.STUB !== 'true'
    if (isLiveEnv) {
      throw new Error(tokenError || 'Drive OAuth token exchange failed — refusing to fabricate folder')
    }
    const safeEmail = email.replace(/[@.]/g, '-')
    const fakeEmailId = `fake-${safeEmail}`
    const fakeYearId = `fake-${safeEmail}-${year}`
    return {
      emailFolderId: fakeEmailId,
      emailFolderUrl: `https://drive.google.com/drive/folders/${fakeEmailId}`,
      yearFolderId: fakeYearId,
      yearFolderUrl: `https://drive.google.com/drive/folders/${fakeYearId}`,
      source: 'stub',
      error: tokenError,
    }
  }

  let rootId: string
  try {
    rootId = (opts?.db ? await getEffectiveDriveRootFolderId(env, opts.db) : getDriveRootFolderId(env)) || 'root'
  } catch {
    rootId = getDriveRootFolderId(env) || 'root'
  }
  const ownerEmail = getDriveOwnerEmail(env)

  // If admin override via parentFolderId, reuse it as email folder; new years filed under it
  let emailFolder: any
  if (opts?.parentFolderId) {
    emailFolder = { id: opts.parentFolderId }
    // L4: also ensure permission on the admin-chosen parent so client can see it
    await ensurePermission(emailFolder.id, email, token, 'writer', ownerEmail)
  } else {
    emailFolder = await searchFolder(email, rootId, token)
    if (!emailFolder) {
      emailFolder = await createFolder(email, rootId, token)
    }
    if (!emailFolder || !emailFolder.id) {
      throw new Error('Failed to ensure email folder')
    }
    await ensurePermission(emailFolder.id, email, token, 'writer', ownerEmail)
  }

  let yearFolder = await searchFolder(String(year), emailFolder.id, token)
  if (!yearFolder) {
    yearFolder = await createFolder(String(year), emailFolder.id, token)
  }
  if (!yearFolder || !yearFolder.id) {
    throw new Error('Failed to ensure year folder')
  }
  await ensurePermission(yearFolder.id, email, token, 'writer', ownerEmail)

  return {
    emailFolderId: emailFolder.id,
    emailFolderUrl: `https://drive.google.com/drive/folders/${emailFolder.id}`,
    yearFolderId: yearFolder.id,
    yearFolderUrl: `https://drive.google.com/drive/folders/${yearFolder.id}`,
    source: 'live',
  }
}

export async function getDriveStorageQuota(env: any): Promise<{ usage: number; limit?: number; usageInDrive?: number; usageInDriveTrash?: number; source: 'live' | 'stub'; error?: string }> {
  const { token, source, error } = await getDriveAccessToken(env)
  if (source === 'stub' || !token) {
    return { usage: 0, source: 'stub', error: error || 'Drive not configured' }
  }
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { usage: 0, source: 'live', error: `Drive about failed ${res.status} ${txt.slice(0, 200)}` }
    }
    const data = (await res.json()) as any
    const q = data.storageQuota || {}
    return {
      usage: Number(q.usage || 0),
      limit: q.limit ? Number(q.limit) : undefined,
      usageInDrive: q.usageInDrive ? Number(q.usageInDrive) : undefined,
      usageInDriveTrash: q.usageInDriveTrash ? Number(q.usageInDriveTrash) : undefined,
      source: 'live',
    }
  } catch (e: any) {
    return { usage: 0, source: 'live', error: e?.message || String(e) }
  }
}
