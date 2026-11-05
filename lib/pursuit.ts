// 「這些人裡面，哪些值得追」的分組與排序。
//
// 比照 lib/event-matching.ts 寫成零 I/O 純函式。
//
// 由來：2026-11-05 量測發現 163 筆名片裡有 160 筆逾期未跟進，最久 142 天，
// 而且全部停在「待跟進」。問題不是系統沒提醒，是積欠太大，
// 每天被告知「欠 160 人」只會讓人更不想打開早報。
//
// 所以第一步不是催，是**分輕重**：先讓使用者看清楚這 160 人裡面
// 真正該花時間的只有二十幾個，其餘可以放心先擱著。
//
// 跟 lib/expo-report.ts 的 rankExpoContacts 的差別：
// 那支是為「單場展覽剛收完的一疊」設計的，這支要處理跨數月的積欠，
// 所以多了分類加權與時間因素。兩邊的核心信念一樣：
// **聊過的人比評分高的人更值得追**，因為那是對方給的訊號，不是 AI 猜的。

export interface PursuitLite {
  id: string
  name: string
  company: string
  score: number
  category: string
  source: string
  isDobBizPotential: boolean
  noteCount: number
  hasEmail: boolean
  hasPhone: boolean
  daysSinceCreated: number
}

/** 分組。刻意用中文而不是 A/B/C，因為使用者看到的就是這三個字 */
export type Band = '該追' | '可追' | '先放'

export interface RankedPursuit extends PursuitLite {
  band: Band
  priority: number
  /** 為什麼排這麼前面，給使用者看的 */
  reasons: string[]
}

/** 不值得花時間的分類 */
const LOW_VALUE_CATEGORIES = new Set(['待觀察'])
/** 本業或轉介有關的分類，加權 */
const CORE_CATEGORIES = new Set(['潛在客戶', '引薦來源'])

/**
 * 一定會被排到「先放」的硬條件。
 *
 * 這幾條跟排名無關，是「就算排第一也不該花時間」的情況，
 * 所以要先篩掉再談排名，否則聯絡不到的人會佔掉前面的名額。
 */
function forcedLow(c: PursuitLite): string | null {
  if (LOW_VALUE_CATEGORIES.has(c.category)) return '待觀察'
  if (c.score <= 5) return '評分偏低'
  if (!c.hasEmail && !c.hasPhone) return '沒有聯絡方式'
  return null
}

/**
 * 分組用「相對排名」而不是絕對門檻。
 *
 * 2026-11-05 用 163 筆正式資料實測，第一版用絕對門檻（評分 ≥8 進該追）
 * 切出來 102 位該追，佔 63%。那不是分輕重，那是「全部都要追」。
 *
 * 根因是所有訊號都偏高：評分 ≥8 有 102 位、DobBiz 潛力 103 位、
 * 有筆記 95 位、有 Email 142 位。四個訊號全部超過半數，
 * 用任何絕對門檻都切不出一份今天做得完的清單。
 *
 * 改成固定取前 N 位，不管分數多高都只給這些，
 * 使用者才有一份「做得完」的待辦。做得完才會真的去做。
 */
const DEFAULT_TOP = 20

/**
 * 組內排序用的優先分數。
 *
 * 「聊過」給最高加權跟 expo-report 一致：有筆記代表你真的停下來談過，
 * 對方的意願訊號比名片本身的評分更可信，單純路過拿名片不會有筆記。
 *
 * 時間只做輕微衰減，不做重罰。放了半年的高分名片還是比昨天收到的
 * 低分名片值得追，過度衰減會把真正的好名單埋掉。
 */
export function rankPursuit(contacts: PursuitLite[], topN = DEFAULT_TOP): RankedPursuit[] {
  const scored = contacts
    .map(c => {
      const reasons: string[] = []
      let priority = c.score

      if (c.noteCount > 0) { priority += 3; reasons.push('聊過') }
      if (c.isDobBizPotential) { priority += 2; reasons.push('DobBiz 潛力') }
      if (CORE_CATEGORIES.has(c.category)) { priority += 1; reasons.push(c.category) }
      if (c.hasEmail) priority += 1
      if (c.daysSinceCreated > 180) priority -= 1
      else if (c.daysSinceCreated > 90) priority -= 0.5

      const low = forcedLow(c)
      if (low) reasons.push(low)

      return { ...c, band: '可追' as Band, priority, reasons, _forced: !!low }
    })
    .sort((a, b) => b.priority - a.priority || b.score - a.score)

  // 先篩掉硬條件，剩下的才照排名分組
  const eligible = scored.filter(r => !r._forced)
  const cut = Math.min(topN, eligible.length)
  const midCut = cut + Math.ceil(eligible.length * 0.4)

  let rank = 0
  for (const r of scored) {
    if (r._forced) { r.band = '先放'; continue }
    r.band = rank < cut ? '該追' : rank < midCut ? '可追' : '先放'
    rank++
  }
  return scored.map(({ _forced, ...rest }) => rest)
}

export interface PursuitSummary {
  total: number
  counts: Record<Band, number>
  /** 該追的前幾位 */
  top: RankedPursuit[]
  /** 場合分布：哪些場合帶來最多「該追」的人 */
  bySource: Array<{ source: string; total: number; worth: number }>
}

export function summarizePursuit(
  contacts: PursuitLite[],
  showN = 8,
  topN = DEFAULT_TOP
): PursuitSummary {
  const ranked = rankPursuit(contacts, topN)
  const counts: Record<Band, number> = { 該追: 0, 可追: 0, 先放: 0 }
  for (const r of ranked) counts[r.band]++

  const map = new Map<string, { total: number; worth: number }>()
  for (const r of ranked) {
    const key = r.source || '未判定'
    const cur = map.get(key) ?? { total: 0, worth: 0 }
    cur.total++
    if (r.band === '該追') cur.worth++
    map.set(key, cur)
  }

  return {
    total: ranked.length,
    counts,
    top: ranked.filter(r => r.band === '該追').slice(0, showN),
    // 先看哪個場合帶來最多該追的人，那才是值得再去的場合
    bySource: [...map.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.worth - a.worth || b.total - a.total),
  }
}

/**
 * 總覽文字。
 *
 * 刻意把「先放」的數字也講出來：使用者真正需要的不是一份待辦，
 * 是「這 160 人裡面有 83 個你可以不用管」這句話。
 * 把壓力拿掉，剩下的二十幾個才追得動。
 */
export function formatPursuitReview(s: PursuitSummary, maxSources = 5): string {
  if (s.total === 0) return '目前沒有待跟進的聯絡人。'

  const lines = [
    `🎯 待跟進 ${s.total} 位，分成三組：`,
    '',
    `該追 ${s.counts.該追} 位｜可追 ${s.counts.可追} 位｜先放 ${s.counts.先放} 位`,
    '',
  ]

  if (s.top.length > 0) {
    lines.push(`該追的前 ${s.top.length} 位：`)
    for (const r of s.top) {
      const why = r.reasons.length ? `　${r.reasons.join('・')}` : ''
      // 公司空白時不要印空括號，那是 OCR 沒讀到公司名的情況
      const company = r.company ? `（${r.company}）` : ''
      lines.push(`・${r.name}${company}⭐${r.score}${why}`)
    }
    lines.push('')
  }

  const sources = s.bySource.filter(x => x.worth > 0).slice(0, maxSources)
  if (sources.length > 0) {
    lines.push('哪些場合帶來該追的人：')
    for (const x of sources) {
      lines.push(`・${x.source}：${x.worth} 位該追（共 ${x.total} 位）`)
    }
    lines.push('')
  }

  lines.push('說「該追的排下週」我一次排進去，或說「看可追的」再往下看一層。')
  return lines.join('\n')
}
