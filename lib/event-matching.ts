import type { calendar_v3 } from 'googleapis'

// 場合判定的純邏輯，不碰任何 I/O，方便單獨驗證。
// 掃名片的當下，日曆上通常正在進行某個活動（BNI 例會、展覽、媒合會），
// 把那個活動當成「在哪認識這個人」，比事後回想準確得多。

export interface MatchedEvent {
  title: string
  location: string
  when: string
  isAllDay: boolean
}

/** 取得 Taipei 時區的 YYYY-MM-DD */
export function taipeiDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

const HOUR = 60 * 60 * 1000
const AFTER_WINDOW = 3 * HOUR // 散會後還會繼續掃名片的時間
const BEFORE_WINDOW = 2 * HOUR // 提早到現場先交換名片

/**
 * 從一組行程中挑出「最可能是認識場合」的那一個。
 * 評分：進行中(100) > 剛散會(80→50) > 即將開始(60→40) > 整天活動(45)。
 * 整天活動分數壓在「剛散會」之下，是因為展覽期間若另有具體會議，
 * 那場會議才是真正認識人的場合。
 */
export function pickBestEvent(events: calendar_v3.Schema$Event[], at: Date): MatchedEvent | null {
  const atDateStr = taipeiDate(at)
  let best: { score: number; startMs: number; event: MatchedEvent } | null = null

  for (const e of events) {
    if (e.status === 'cancelled') continue
    const title = e.summary?.trim()
    if (!title) continue

    let score: number
    let when: string
    let startMs = 0
    let isAllDay = false

    if (e.start?.dateTime && e.end?.dateTime) {
      const start = new Date(e.start.dateTime)
      const end = new Date(e.end.dateTime)
      const t = at.getTime()

      if (t >= start.getTime() && t <= end.getTime()) {
        score = 100
      } else if (t > end.getTime() && t - end.getTime() <= AFTER_WINDOW) {
        score = 80 - ((t - end.getTime()) / AFTER_WINDOW) * 30
      } else if (t < start.getTime() && start.getTime() - t <= BEFORE_WINDOW) {
        score = 60 - ((start.getTime() - t) / BEFORE_WINDOW) * 20
      } else {
        continue
      }

      startMs = start.getTime()
      when = start.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
        weekday: 'short', hour: '2-digit', minute: '2-digit',
      })
    } else if (e.start?.date && e.end?.date) {
      // 整天活動（展覽、參訪），Google 的 end.date 是不含當天的隔天
      if (atDateStr < e.start.date || atDateStr >= e.end.date) continue
      score = 45
      isAllDay = true
      when = new Date(`${atDateStr}T00:00:00+08:00`).toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short',
      })
    } else {
      continue
    }

    // 同分時取「最晚開始」的那個：兩個行程重疊時，你最近走進去的才是現在人在的場合。
    // 實例：10/21 早上 BNI 例會 06:30-09:30 與五金展 08:00-18:00 重疊，
    // 08:30 掃的名片應該算五金展，不是先開始的 BNI。
    // 反過來也成立：展期中 14:00 的洽談會贏過整天的展覽，因為洽談才是認識對方的場合。
    if (!best || score > best.score || (score === best.score && startMs > best.startMs)) {
      best = { score, startMs, event: { title, location: e.location?.trim() || '', when, isAllDay } }
    }
  }

  return best?.event || null
}
