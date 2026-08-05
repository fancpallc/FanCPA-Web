import { getOAuthClientId, getOAuthClientSecret, getOAuthRefreshToken, getBookingCalendarId } from './env'
import { TIMEZONE } from './google-calendar'

export interface OAuthEnv {
  GOOGLE_OAUTH_CLIENT_ID?: string
  GOOGLE_OAUTH_CLIENT_SECRET?: string
  GOOGLE_OAUTH_REFRESH_TOKEN?: string
  OAUTH_CLIENT_ID?: string
  OAUTH_CLIENT_SECRET?: string
  OAUTH_REFRESH_TOKEN?: string
  BOOKING_CALENDAR_ID?: string
  BOOKING?: string
  SITE_URL?: string
  ENVIRONMENT?: string
  TIMEZONE?: string
  [key: string]: any
}

export interface OAuthCreateParams {
  firstName: string
  lastName: string
  email: string
  phone?: string
  purpose?: string
  slot: { date: string; start: string; end: string }
  cancelToken: string
  siteUrl: string
}

export interface OAuthCreateResult {
  calendarEventId: string
  meetLink: string
  source: 'live-oauth' | 'stub'
  error?: string
}

async function getOAuthAccessToken(env: any): Promise<{ accessToken: string; error?: string }> {
  const clientId = getOAuthClientId(env)
  const clientSecret = getOAuthClientSecret(env)
  const refreshToken = getOAuthRefreshToken(env)

  console.log(`!!! OAUTH_TOKEN_START hasClientId=${!!clientId} hasSecret=${!!clientSecret} hasRefresh=${!!refreshToken}`)

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('!!! OAUTH_TOKEN_MISSING missing OAuth config')
    return { accessToken: '', error: 'OAuth config missing — need CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN' }
  }

  try {
    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('client_secret', clientSecret)
    params.append('refresh_token', refreshToken)
    params.append('grant_type', 'refresh_token')

    console.log('!!! OAUTH_TOKEN_FETCH_START')
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    const text = await res.text()
    console.log(`!!! OAUTH_TOKEN_RESPONSE status=${res.status} ok=${res.ok} bodyLen=${text.length}`)

    if (!res.ok) {
      console.log(`!!! OAUTH_TOKEN_FAILED status=${res.status} body=${text.slice(0, 500)}`)
      throw new Error(`OAuth token exchange failed ${res.status} ${text.slice(0, 300)}`)
    }

    const json = JSON.parse(text) as any
    console.log(`!!! OAUTH_TOKEN_SUCCESS hasAccessToken=${!!json.access_token} expiresIn=${json.expires_in}`)
    return { accessToken: json.access_token }
  } catch (e: any) {
    console.log(`!!! OAUTH_TOKEN_EXCEPTION ${e?.message}`)
    return { accessToken: '', error: e?.message }
  }
}

export async function createBookingEventViaOAuth(env: any, params: OAuthCreateParams): Promise<OAuthCreateResult> {
  const bookingId = getBookingCalendarId(env)
  const siteUrl = params.siteUrl || env?.SITE_URL || 'https://profile-webapp.pages.dev'

  console.log(`!!! OAUTH_CREATE_START bookingId=${bookingId ? bookingId.slice(0, 8) + '...' : 'missing'} slot=${params.slot.start} email=${params.email}`)

  if (!bookingId) {
    console.log('!!! OAUTH_CREATE_FAIL_NO_BOOKING_ID')
    return {
      calendarEventId: `missing-booking-${params.cancelToken}`,
      meetLink: `https://meet.google.com/fake-missing-${params.cancelToken.slice(0, 4)}`,
      source: 'stub',
      error: 'BOOKING_CALENDAR_ID missing',
    }
  }

  const { accessToken, error: tokenError } = await getOAuthAccessToken(env)

  if (!accessToken) {
    console.log(`!!! OAUTH_CREATE_FAIL_NO_ACCESS_TOKEN error=${tokenError}`)
    return {
      calendarEventId: `stub-oauth-no-token-${params.cancelToken}`,
      meetLink: `https://meet.google.com/fake-no-token-${params.cancelToken.slice(0, 4)}`,
      source: 'stub',
      error: tokenError || 'No OAuth access token',
    }
  }

  try {
    // For OAuth user credentials (personal Gmail), attendees ARE allowed and Meet IS allowed on group calendars
    // Unlike SA, OAuth acts as real user metagtmtest1@gmail.com
    const eventPayload = {
      summary: `Meeting with ${params.firstName} ${params.lastName}`,
      description: `${params.purpose || 'Intro call'}\n\nContact: ${params.email} ${params.phone || ''}\n\nCancel: ${siteUrl}/api/cancel/${params.cancelToken}`,
      start: { dateTime: params.slot.start, timeZone: env?.TIMEZONE || TIMEZONE },
      end: { dateTime: params.slot.end, timeZone: env?.TIMEZONE || TIMEZONE },
      attendees: [{ email: params.email, displayName: `${params.firstName} ${params.lastName}` }],
      conferenceData: {
        createRequest: {
          requestId: params.cancelToken,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'email', minutes: 60 }],
      },
    }

    console.log(`!!! OAUTH_EVENT_CREATE_POST summary=${eventPayload.summary} start=${eventPayload.start.dateTime}`)

    const createRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(eventPayload),
    })

    const createText = await createRes.text()
    console.log(`!!! OAUTH_EVENT_CREATE_RESPONSE status=${createRes.status} ok=${createRes.ok} bodyLen=${createText.length}`)

    if (!createRes.ok) {
      console.log(`!!! OAUTH_EVENT_CREATE_FAILED status=${createRes.status} body=${createText.slice(0, 800)}`)
      // If invalid conference type still happens even with OAuth, try without conferenceData then PATCH
      if (createText.includes('Invalid conference type')) {
        console.log('!!! OAUTH_RETRY_BARE_NO_MEET')
        const barePayload = {
          summary: eventPayload.summary,
          description: eventPayload.description,
          start: eventPayload.start,
          end: eventPayload.end,
          attendees: eventPayload.attendees,
        }
        const bareRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events?sendUpdates=all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(barePayload),
        })
        const bareText = await bareRes.text()
        console.log(`!!! OAUTH_BARE_RESPONSE status=${bareRes.status} ok=${bareRes.ok}`)
        if (!bareRes.ok) {
          console.log(`!!! OAUTH_BARE_FAILED ${bareText.slice(0, 500)}`)
          throw new Error(`OAuth bare event failed ${bareRes.status} ${bareText}`)
        }
        const bareCreated = JSON.parse(bareText) as any
        // Try PATCH Meet
        try {
          console.log('!!! OAUTH_TRY_PATCH_MEET')
          const patchRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events/${encodeURIComponent(bareCreated.id)}?conferenceDataVersion=1`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              conferenceData: {
                createRequest: { requestId: params.cancelToken + '-patch', conferenceSolutionKey: { type: 'hangoutsMeet' } },
              },
            }),
          })
          const patchText = await patchRes.text()
          console.log(`!!! OAUTH_PATCH_RESPONSE status=${patchRes.status} ok=${patchRes.ok}`)
          if (patchRes.ok) {
            const patched = JSON.parse(patchText) as any
            const meetLink = patched.conferenceData?.entryPoints?.[0]?.uri || patched.hangoutLink || ''
            console.log(`!!! OAUTH_PATCH_SUCCESS meetLink=${meetLink}`)
            if (meetLink) {
              return { calendarEventId: bareCreated.id, meetLink, source: 'live-oauth' }
            }
          }
        } catch (e: any) {
          console.log(`!!! OAUTH_PATCH_EXCEPTION ${e?.message}`)
        }
        // Bare succeeded but no Meet — still live event
        return {
          calendarEventId: bareCreated.id,
          meetLink: '',
          source: 'live-oauth',
          error: 'Bare OAuth event created but Meet not added — group calendar may not support Meet even via OAuth, but slot blocked',
        }
      }
      throw new Error(`OAuth create failed ${createRes.status} ${createText}`)
    }

    const created = JSON.parse(createText) as any
    const meetLink = created.conferenceData?.entryPoints?.[0]?.uri || created.hangoutLink || ''
    console.log(`!!! OAUTH_EVENT_CREATED id=${created.id} meetLink=${meetLink || 'none'}`)

    // Patch description to include Meet + cancel
    if (meetLink) {
      try {
        console.log('!!! OAUTH_PATCH_DESCRIPTION')
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingId)}/events/${encodeURIComponent(created.id)}?conferenceDataVersion=1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            description: `${params.purpose || 'Intro call'}\n\nMeet: ${meetLink}\nCancel: ${siteUrl}/api/cancel/${params.cancelToken}\n\nContact: ${params.email} ${params.phone || ''}`,
          }),
        })
      } catch {}
    }

    return {
      calendarEventId: created.id,
      meetLink: meetLink || `https://meet.google.com/fake-oauth-no-meet-${params.cancelToken.slice(0, 4)}`,
      source: 'live-oauth',
      error: !meetLink ? 'OAuth event created but no Meet link returned' : undefined,
    }
  } catch (e: any) {
    console.log(`!!! OAUTH_CREATE_EXCEPTION ${e?.message}`)
    return {
      calendarEventId: `stub-oauth-exc-${params.cancelToken}`,
      meetLink: `https://meet.google.com/fake-oauth-exc-${params.cancelToken.slice(0, 4)}`,
      source: 'stub',
      error: e?.message,
    }
  }
}
