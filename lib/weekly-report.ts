// 人脈與商機週報（純函式，不碰 Firestore）。
//
// 早報回答「今天要做什麼」，週報回答「這週哪裡卡住了」。
// 設計原則：只列會讓人採取行動的東西，不做無法行動的統計美化。

export interface WeeklyContactLite {
  name: string
  company: string
  score: number
  category: string
  status: string
  source: string
  isDobBizPotential: boolean
  createdAtMs: number
  followUpAtMs: number
}

export interface WeeklyDealLite {
  client: string
  amount: number
  product: string
  signedAtMs: number
}

export interface WeeklyPaymentLite {
  client: string
  amount: number
  paidAtMs: number
}

const DAY_MS = 86400000

/** 台灣時區下，本週一 00:00 的毫秒時間 */
export function weekStartMs(now: Date): number {
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const dow = (taipei.getDay() + 6) % 7 // 週一為 0
  taipei.setHours(0, 0, 0, 0)
  return taipei.getTime() - dow * DAY_MS
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' })
}

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-TW')
}

function countBy<T>(items: T[], key: (t: T) => string): Array<[string, number]> {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * 產生週報全文。回傳 null 代表這週完全沒有值得回報的東西，
 * 不要為了「有發」而發一封空報告。
 */
export function buildWeeklyReport(
  now: Date,
  contacts: WeeklyContactLite[],
  deals: WeeklyDealLite[],
  payments: WeeklyPaymentLite[]
): string | null {
  const nowMs = now.getTime()
  const startMs = weekStartMs(now)

  const newContacts = contacts.filter(c => c.createdAtMs >= startMs)
  const overdue = contacts
    .filter(c => c.status === '待跟進' && c.followUpAtMs > 0 && c.followUpAtMs <= nowMs)
    .sort((a, b) => a.followUpAtMs - b.followUpAtMs)
  const proposed = contacts
    .filter(c => c.status === '已提案')
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
  const dobBizUntouched = contacts
    .filter(c => c.isDobBizPotential && c.status === '待跟進')
    .sort((a, b) => b.score - a.score)

  const weekDeals = deals.filter(d => d.signedAtMs >= startMs)
  const weekPayments = payments.filter(p => p.paidAtMs >= startMs)

  const hasAnything =
    newContacts.length > 0 || overdue.length > 0 || proposed.length > 0 ||
    weekDeals.length > 0 || weekPayments.length > 0
  if (!hasAnything) return null

  const lines = [`📊 人脈週報｜${fmtDate(startMs)} - ${fmtDate(nowMs)}`, '']

  if (weekDeals.length > 0 || weekPayments.length > 0) {
    const dealSum = weekDeals.reduce((s, d) => s + d.amount, 0)
    const paySum = weekPayments.reduce((s, p) => s + p.amount, 0)
    lines.push('💰 本週業績')
    if (weekDeals.length > 0) lines.push(`  簽案 ${weekDeals.length} 筆｜${fmtMoney(dealSum)} 元`)
    if (weekPayments.length > 0) lines.push(`  收款 ${weekPayments.length} 筆｜${fmtMoney(paySum)} 元`)
    lines.push('')
  }

  if (newContacts.length > 0) {
    lines.push(`🆕 本週新增 ${newContacts.length} 位`)
    for (const [source, n] of countBy(newContacts, c => c.source || '未記錄場合').slice(0, 4)) {
      lines.push(`  ・${source} ${n} 位`)
    }
    lines.push('')
  }

  if (overdue.length > 0) {
    lines.push(`⏰ 逾期未跟進 ${overdue.length} 位｜最久的前 3 位`)
    for (const c of overdue.slice(0, 3)) {
      const days = Math.floor((nowMs - c.followUpAtMs) / DAY_MS)
      lines.push(`  ・${c.name}${c.company ? `（${c.company}）` : ''} 逾期 ${days} 天 ⭐${c.score}`)
    }
    lines.push('')
  }

  if (proposed.length > 0) {
    lines.push(`🐢 已提案未成交 ${proposed.length} 位`)
    for (const c of proposed.slice(0, 3)) {
      const days = Math.floor((nowMs - c.createdAtMs) / DAY_MS)
      lines.push(`  ・${c.name}${c.company ? `（${c.company}）` : ''} 認識 ${days} 天`)
    }
    lines.push('')
  }

  if (dobBizUntouched.length > 0) {
    lines.push(`🔗 DobBiz 潛力尚未接觸 ${dobBizUntouched.length} 位｜評分最高的前 3 位`)
    for (const c of dobBizUntouched.slice(0, 3)) {
      lines.push(`  ・${c.name}${c.company ? `（${c.company}）` : ''} ⭐${c.score}`)
    }
    lines.push('')
  }

  // 收尾給一個明確動作，而不是讓使用者自己從清單裡挑
  const topAction = overdue[0] || dobBizUntouched[0] || proposed[0]
  if (topAction) {
    lines.push(`🎯 這週先做這一件：聯絡 ${topAction.name}${topAction.company ? `（${topAction.company}）` : ''}`)
  }

  return lines.join('\n').trim()
}
