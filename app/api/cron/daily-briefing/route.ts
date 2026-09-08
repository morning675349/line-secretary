export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { pushMessage, pushMessageWithQuickReply } from '@/lib/line-client'
import { getTodayEvents } from '@/lib/google-calendar'
import { getPendingFollowUps, getAllContacts, Contact } from '@/lib/contact-service'
import { getDeals, getPayments } from '@/lib/deal-service'
import { requireCronAuth } from '@/lib/cron-auth'
import { getPostingReminder, POSTING_REMINDER_OWNER } from '@/lib/posting-schedule'
import {
  contactMatchesEvent, formatEventIntel, stripNoteTimestamp, daysSince,
  ContactIntel, EventLite,
} from '@/lib/meeting-intel'
import { buildWeeklyReport, WeeklyContactLite } from '@/lib/weekly-report'
import { pruneProcessedEvents } from '@/lib/dedup'

// 一則行程最多附幾個人的情報，再多早報就變成落落長的資料庫傾印
const MAX_INTEL_PER_EVENT = 2

function toIntel(c: Contact, now: Date): ContactIntel {
  const lastNote = c.notes?.length ? stripNoteTimestamp(c.notes[c.notes.length - 1]) : ''
  return {
    name: c.nameZh || c.nameEn || '未知',
    company: c.company || '',
    title: c.title || '',
    score: c.score ?? 0,
    category: c.category || '',
    status: c.status || '',
    source: c.source || '',
    followUpSuggestion: c.followUpSuggestion || '',
    lastNote,
    notesCount: c.notes?.length ?? 0,
    knownForDays: c.createdAt ? daysSince(c.createdAt.toDate(), now) : 0,
  }
}

function toWeeklyLite(c: Contact): WeeklyContactLite {
  return {
    name: c.nameZh || c.nameEn || '未知',
    company: c.company || '',
    score: c.score ?? 0,
    category: c.category || '',
    status: c.status || '',
    source: c.source || '',
    isDobBizPotential: !!c.isDobBizPotential,
    createdAtMs: c.createdAt ? c.createdAt.toMillis() : 0,
    followUpAtMs: c.followUpAt ? c.followUpAt.toMillis() : 0,
  }
}

/** 今日行程逐則附上「等下要見的是誰、上次聊到哪」 */
function buildScheduleSection(events: EventLite[], contacts: Contact[], now: Date): string[] {
  const lines = ['📅 今日行程：']
  for (const ev of events) {
    const haystack = `${ev.title} ${ev.location}`
    const matches = contacts
      .filter(c => contactMatchesEvent(haystack, c))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, MAX_INTEL_PER_EVENT)
      .map(c => toIntel(c, now))
    lines.push(...formatEventIntel(ev, matches).map(l => `  ${l}`))
  }
  return lines
}

function isSundayInTaipei(now: Date): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(now) === 'Sun'
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const now = new Date()
  const usersSnap = await db.collection('users').get()
  const results: Array<{ user: string; sent: boolean; weekly?: boolean; error?: string }> = []

  for (const userDoc of usersSnap.docs) {
    const lineUserId = userDoc.id
    try {
      // 用 contact-service 的版本：它刻意避開 where + orderBy 的複合查詢，
      // 因為那需要額外建 Firestore 索引，缺索引時會整個早報無聲失敗。
      const followUps = await getPendingFollowUps(lineUserId)
      const contacts = await getAllContacts(lineUserId)

      let events: EventLite[] = []
      try {
        events = await getTodayEvents(lineUserId)
      } catch {
        // Calendar not connected
      }

      // 發文提醒只推給帳號本人；其他使用者維持原本的早報行為。
      const postingReminder = lineUserId === POSTING_REMINDER_OWNER ? getPostingReminder(now) : null

      if (followUps.length === 0 && events.length === 0 && !postingReminder) {
        results.push({ user: lineUserId.slice(0, 8), sent: false })
        continue
      }

      const today = now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' })
      const lines = [`🌅 早安！${today}`, '']

      if (events.length > 0) {
        lines.push(...buildScheduleSection(events, contacts, now))
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

      // 早報附快速回覆，讓使用者一鍵接續下一步而不用打字
      await pushMessageWithQuickReply(lineUserId, lines.join('\n'), ['跟進', '今日行程', '統計'])

      // 週報獨立成一則，避免週日的早報變成一面看不完的牆
      let weeklySent = false
      if (isSundayInTaipei(now)) {
        const [deals, payments] = await Promise.all([getDeals(lineUserId), getPayments(lineUserId)])
        const report = buildWeeklyReport(
          now,
          contacts.map(toWeeklyLite),
          deals.map(d => ({ client: d.client, amount: d.amount, product: d.product, signedAtMs: d.signedAt.toMillis() })),
          payments.map(p => ({ client: p.client, amount: p.amount, paidAtMs: p.paidAt.toMillis() }))
        )
        if (report) {
          await pushMessage(lineUserId, report)
          weeklySent = true
        }
      }

      results.push({ user: lineUserId.slice(0, 8), sent: true, weekly: weeklySent })
    } catch (err) {
      // 失敗要留下痕跡並回報，不能只吞掉：早報曾因缺 Firestore 索引整整無聲失敗
      console.error(`Daily briefing error for ${lineUserId}:`, err)
      results.push({ user: lineUserId.slice(0, 8), sent: false, error: String(err).slice(0, 200) })
    }
  }

  // 順手清掉過期的事件去重紀錄，失敗不影響早報本身
  let pruned = 0
  try {
    pruned = await pruneProcessedEvents()
  } catch (err) {
    console.error('pruneProcessedEvents failed:', err)
  }

  const failed = results.filter(r => r.error).length
  return NextResponse.json({ ok: failed === 0, users: results.length, failed, pruned, results })
}
