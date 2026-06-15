export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { pushMessage } from '@/lib/line-client'
import { getTodayEvents } from '@/lib/google-calendar'
import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const usersSnap = await db.collection('users').get()

  for (const userDoc of usersSnap.docs) {
    const lineUserId = userDoc.id
    try {
      const now = Timestamp.now()
      const followUpsSnap = await db
        .collection('contacts')
        .where('lineUserId', '==', lineUserId)
        .where('status', '==', '待跟進')
        .where('followUpAt', '<=', now)
        .orderBy('followUpAt')
        .limit(5)
        .get()

      const followUps = followUpsSnap.docs.map((d: QueryDocumentSnapshot) => d.data())

      let events: Array<{ time: string; title: string; location: string }> = []
      try {
        events = await getTodayEvents(lineUserId)
      } catch {
        // Calendar not connected
      }

      if (followUps.length === 0 && events.length === 0) continue

      const today = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' })
      const lines = [`🌅 早安！${today}`, '']

      if (events.length > 0) {
        lines.push('📅 今日行程：')
        events.forEach(e => {
          lines.push(`  ${e.time} ${e.title}${e.location ? ` @ ${e.location}` : ''}`)
        })
        lines.push('')
      }

      if (followUps.length > 0) {
        lines.push(`📋 今日需跟進（${followUps.length} 人）：`)
        followUps.forEach(c => {
          const name = c.nameZh || c.nameEn || '未知'
          lines.push(`  · ${name}（${c.company}）⭐${c.score} ${c.category}`)
        })
        lines.push('')
        lines.push('輸入「跟進」查看詳情')
      }

      await pushMessage(lineUserId, lines.join('\n'))
    } catch (err) {
      console.error(`Daily briefing error for ${lineUserId}:`, err)
    }
  }

  return NextResponse.json({ ok: true })
}
