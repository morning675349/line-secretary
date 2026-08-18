export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { pushMessage } from '@/lib/line-client'
import { getTodayEvents } from '@/lib/google-calendar'
import { getPendingFollowUps } from '@/lib/contact-service'
import { requireCronAuth } from '@/lib/cron-auth'
import { getPostingReminder, POSTING_REMINDER_OWNER } from '@/lib/posting-schedule'

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const usersSnap = await db.collection('users').get()
  const results: Array<{ user: string; sent: boolean; error?: string }> = []

  for (const userDoc of usersSnap.docs) {
    const lineUserId = userDoc.id
    try {
      // 用 contact-service 的版本：它刻意避開 where + orderBy 的複合查詢，
      // 因為那需要額外建 Firestore 索引，缺索引時會整個早報無聲失敗。
      const followUps = await getPendingFollowUps(lineUserId)

      let events: Array<{ time: string; title: string; location: string }> = []
      try {
        events = await getTodayEvents(lineUserId)
      } catch {
        // Calendar not connected
      }

      // 發文提醒只推給帳號本人；其他使用者維持原本的早報行為。
      const postingReminder = lineUserId === POSTING_REMINDER_OWNER ? getPostingReminder(new Date()) : null

      if (followUps.length === 0 && events.length === 0 && !postingReminder) {
        results.push({ user: lineUserId.slice(0, 8), sent: false })
        continue
      }

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
        lines.push('')
      }

      if (postingReminder) {
        lines.push('📣 今日發文提醒：')
        lines.push(`  ${postingReminder}`)
        lines.push('')
        lines.push('（養號期：一天一篇，發完關 App，過幾小時回來回留言）')
      }

      await pushMessage(lineUserId, lines.join('\n'))
      results.push({ user: lineUserId.slice(0, 8), sent: true })
    } catch (err) {
      // 失敗要留下痕跡並回報，不能只吞掉：早報曾因缺 Firestore 索引整整無聲失敗
      console.error(`Daily briefing error for ${lineUserId}:`, err)
      results.push({ user: lineUserId.slice(0, 8), sent: false, error: String(err).slice(0, 200) })
    }
  }

  const failed = results.filter(r => r.error).length
  return NextResponse.json({ ok: failed === 0, users: results.length, failed, results })
}
