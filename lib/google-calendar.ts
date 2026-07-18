import { google } from 'googleapis'
import { randomBytes } from 'crypto'
import { db } from './firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 分鐘

function getOAuth2Client() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://line-secretary-m6ji.vercel.app'
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${baseUrl}/api/auth/google/callback`
  )
}

// 安全性說明：OAuth state 過去直接帶 lineUserId 明碼，任何知道／猜到某個
// LINE userId 的人都能自行走一次 Google 授權流程、把自己的 Google 帳號
// 綁定到別人的 lineUserId 上（帳號綁定 CSRF）。改為隨機、單次使用、限時
// 有效的 state token，並在 Firestore 暫存 state→lineUserId 對應，從根本
// 避免 state 被冒用。
export async function getAuthUrl(lineUserId: string): Promise<string> {
  const client = getOAuth2Client()
  const state = randomBytes(24).toString('hex')
  await db.collection('oauth_states').doc(state).set({
    lineUserId,
    createdAt: Timestamp.now(),
  })
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state,
  })
}

/** 驗證並消費 OAuth state，回傳對應的 lineUserId（無效/過期則回傳 null） */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const ref = db.collection('oauth_states').doc(state)
  const doc = await ref.get()
  if (!doc.exists) return null
  await ref.delete() // 單次使用，用過即刪，避免重放

  const data = doc.data()
  const lineUserId = data?.lineUserId as string | undefined
  const createdAt = data?.createdAt as Timestamp | undefined
  if (!lineUserId || !createdAt) return null
  if (Date.now() - createdAt.toMillis() > OAUTH_STATE_TTL_MS) return null

  return lineUserId
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
