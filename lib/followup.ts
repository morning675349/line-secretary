// 跟進循環的判斷邏輯。
//
// 比照 lib/event-matching.ts 寫成零 I/O 純函式，碰 Firestore 的那層在 contact-service。
//
// 由來：2026-11-05 盤點發現這套系統只管「第一次」跟進。
// followUpAt 只有建檔時算過一次，在 LINE 裡完全沒有辦法改，
// 而標記「已聯絡」之後那個人就從跟進清單永遠消失了。
// 但 B2B 一個案子要碰三到六次、跨好幾個月，所以等於追蹤到第一次就斷掉。
//
// 這個模組補兩件事：排下一次跟進的日期驗證，以及「卡在某個階段太久」的偵測。

const DAY_MS = 86_400_000
const TAIPEI_OFFSET_MS = 8 * 3_600_000

/**
 * 各階段停留多久該被提醒。
 *
 * 不做成獨立的「卡關清單」是刻意的：逾期的人本來就會進今日跟進清單，
 * 再列一次就是同一件事講兩遍，而重複的提醒會讓人開始略過整封早報。
 * 改成在跟進清單上標註「已提案 23 天」，一行把兩件事都講完。
 *
 * 「已提案」的門檻比「已聯絡」長，因為提案後本來就要給對方內部討論的時間。
 */
export const STAGE_ALERT_DAYS: Record<string, number> = {
  已聯絡: 14,
  已提案: 21,
}

export interface StallCandidate {
  id?: string
  nameZh?: string
  nameEn?: string
  company?: string
  status?: string
  score?: number
  /** 狀態最後一次變更的時間 */
  statusChangedAtMs?: number
  createdAtMs?: number
}

/**
 * 在目前狀態停留幾天。
 *
 * statusChangedAtMs 不存在時退回 createdAtMs：這個欄位是後來才加的，
 * 既有的一百多筆聯絡人都沒有。不退回的話舊資料會全部算不出天數而靜默消失，
 * 那正好是最該被提醒的一批（放最久的）。
 */
export function daysInStatus(c: StallCandidate, nowMs: number): number | null {
  const since = c.statusChangedAtMs ?? c.createdAtMs
  if (!since || since > nowMs) return null
  return Math.floor((nowMs - since) / DAY_MS)
}

/** 這個階段停留太久了嗎 */
export function isStageOverdue(c: StallCandidate, nowMs: number): boolean {
  const threshold = STAGE_ALERT_DAYS[c.status || '']
  if (threshold === undefined) return false
  const days = daysInStatus(c, nowMs)
  return days !== null && days >= threshold
}

const nameOf = (c: StallCandidate) => c.nameZh || c.nameEn || '未知'

/**
 * 跟進清單上的一行。
 *
 * 會標出階段與停留天數，因為「他在哪一階段卡多久」比「他是誰」更能決定
 * 今天要用什麼方式聯絡：卡在已提案三週要打電話，剛加的名片寄封信就好。
 */
export function formatDueLine(c: StallCandidate, nowMs: number): string {
  const company = c.company ? `（${c.company}）` : ''
  const days = daysInStatus(c, nowMs)
  const stage = c.status && c.status !== '待跟進' ? ` ${c.status}` : ''
  const since = days !== null && days > 0 ? ` 已 ${days} 天` : ''
  const alert = isStageOverdue(c, nowMs) ? ' ⚠️' : ''
  return `  · ${nameOf(c)}${company}${stage}${since}${alert} ⭐${c.score ?? 0}`
}

export interface NormalizedDate {
  ok: boolean
  /** Taipei 當天零點的毫秒數 */
  ms?: number
  reason?: string
}

/** Taipei 當天零點（UTC 毫秒） */
function taipeiMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) - TAIPEI_OFFSET_MS
}

/** 今天在 Taipei 是幾月幾號 */
function taipeiToday(nowMs: number): { y: number; m: number; d: number } {
  const t = new Date(nowMs + TAIPEI_OFFSET_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/**
 * 驗證並正規化 agent 算出來的跟進日期。
 *
 * 日期由 agent 從「三月初」「下週三」這種口語換算，system prompt 有給它今天日期。
 * 但模型算日期會錯，最常見的是年份用成去年，所以**過去的日期一律拒絕**而不是默默接受。
 * 接受了的話那個人會立刻出現在「今日需跟進」，看起來像系統壞掉。
 *
 * 設成 Taipei 零點而不是當下時刻：早報在早上八點跑，
 * 比對條件是 followUpAt <= now，設零點才會在當天的早報就出現，
 * 設成當下時刻會延到隔天才提醒。
 */
export function normalizeFollowUpDate(input: string, nowMs: number): NormalizedDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((input || '').trim())
  if (!m) return { ok: false, reason: '日期格式要是 YYYY-MM-DD' }

  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = taipeiMidnight(y, mo, d)
  // 用回推確認是真實日期，擋掉 2 月 30 號這種會被 Date 自動進位的輸入
  const back = new Date(ms + TAIPEI_OFFSET_MS)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== mo || back.getUTCDate() !== d) {
    return { ok: false, reason: `${input} 不是真實存在的日期` }
  }

  const today = taipeiToday(nowMs)
  const todayMs = taipeiMidnight(today.y, today.m, today.d)
  if (ms < todayMs) {
    return { ok: false, reason: `${input} 已經過去了，請確認年份` }
  }
  if (ms - todayMs > 730 * DAY_MS) {
    return { ok: false, reason: `${input} 距離超過兩年，請確認` }
  }
  return { ok: true, ms }
}
