import { google } from 'googleapis'
import { db } from './firebase-admin'

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`
  )
}

export function getAuthUrl(lineUserId: string): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: lineUserId,
  })
}

export async function saveTokens(lineUserId: string, code: string): Promise<void> {
  const client = getOAuth2Client()
  const { tokens } = await client.getToken(code)
  await db.collection('users').doc(lineUserId).set({ googleTokens: tokens }, { merge: true })
}

async function getCalendarClient(lineUserId: string) {
  const client = getOAuth2Client()
  const doc = await db.collection('users').doc(lineUserId).get()
  const tokens = doc.data()?.googleTokens
  if (!tokens) throw new Error('NOT_AUTHORIZED')

  client.setCredentials(tokens)
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) {
    const { credentials } = await client.refreshAccessToken()
    await db.collection('users').doc(lineUserId).update({ googleTokens: credentials })
    client.setCredentials(credentials)
  }
  return google.calendar({ version: 'v3', auth: client })
}

export async function createCalendarEvent(
  lineUserId: string,
  title: string,
  start: Date,
  end: Date,
  location?: string,
  description?: string
): Promise<string> {
  const calendar = await getCalendarClient(lineUserId)
  const event = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      location,
      description,
      start: { dateTime: start.toISOString(), timeZone: 'Asia/Taipei' },
      end: { dateTime: end.toISOString(), timeZone: 'Asia/Taipei' },
    },
  })
  return event.data.htmlLink || ''
}

export async function getTodayEvents(lineUserId: string): Promise<Array<{ time: string; title: string; location: string }>> {
  const calendar = await getCalendarClient(lineUserId)
  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59)

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: endOfDay.toISOString(),
    timeZone: 'Asia/Taipei',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 10,
  })

  return (res.data.items || []).map(e => ({
    time: e.start?.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' })
      : '全天',
    title: e.summary || '(無標題)',
    location: e.location || '',
  }))
}

export async function isCalendarConnected(lineUserId: string): Promise<boolean> {
  const doc = await db.collection('users').doc(lineUserId).get()
  return !!doc.data()?.googleTokens
}
