// 會前情報：把行事曆上的行程，跟人脈庫裡的人對起來。
//
// 開會前最想知道的不是「幾點在哪」，而是「等下要見的這個人，上次聊到哪」。
// 這裡只做純邏輯（比對與格式化），不碰 Firestore 與日曆 API，方便單獨測試。

export interface EventLite {
  title: string
  time: string
  location: string
}

/** 從 Contact 抽出情報需要的欄位，避免這層依賴 Firestore 型別 */
export interface ContactIntel {
  name: string
  company: string
  title: string
  score: number
  category: string
  status: string
  source: string
  followUpSuggestion: string
  lastNote: string
  notesCount: number
  knownForDays: number
}

// 公司名的贅字，比對前先剝掉，「大展精密工業股份有限公司」→「大展精密工業」
const COMPANY_SUFFIXES = [
  '股份有限公司', '有限公司', '企業社', '工作室', '事務所',
  '實業社', '工業社', '商行', '企業', '實業', '公司', '工廠',
  // 英文常見結尾
  'Co\\.,? ?Ltd\\.?', 'Ltd\\.?', 'Inc\\.?', 'Corp\\.?', 'LLC', 'Limited', 'Company',
]

// 過於通用的詞，單獨出現時不足以判定是同一家公司
const TOO_GENERIC = new Set([
  '台灣', '臺灣', '中華', '國際', '科技', '設計', '行銷', '顧問',
  '企業', '實業', '工業', '貿易', '製造', '生技', '文化', '創意',
])

/** 剝掉公司贅字，取出可用來比對的核心名稱 */
export function companyCore(company: string): string {
  let core = company.trim()
  for (const suffix of COMPANY_SUFFIXES) {
    core = core.replace(new RegExp(suffix + '$', 'i'), '').trim()
  }
  return core.trim()
}

/**
 * 產生可用來比對的公司代號。
 *
 * 行事曆標題幾乎都寫簡稱：名片上是「大展精密工業股份有限公司」，
 * 行程標題只會寫「大展精密」甚至「大展」。所以除了完整核心名，
 * 也把前 2 到 4 個字當作候選（英文公司則取第一個單字）。
 */
function companyTokens(raw: string): string[] {
  const core = companyCore(raw || '')
  if (!core) return []
  const tokens = [core]
  if (/\s/.test(core)) {
    tokens.push(core.split(/\s+/)[0])
  } else {
    for (const len of [4, 3, 2]) {
      if (core.length > len) tokens.push(core.slice(0, len))
    }
  }
  return tokens.filter(isDistinctive)
}

/** 這個詞是否夠獨特，可以拿來判定行程與聯絡人是同一件事 */
function isDistinctive(token: string): boolean {
  return token.length >= 2 && !TOO_GENERIC.has(token)
}

/**
 * 判斷某位聯絡人是否出現在這個行程裡。
 *
 * 比對姓名全名或公司核心名，不做單字（如「林」）比對，
 * 因為單姓在行程標題裡誤判率極高（「林董」「林口」都會中）。
 */
export function contactMatchesEvent(
  eventText: string,
  contact: { nameZh?: string; nameEn?: string; company?: string; companyEn?: string }
): boolean {
  const text = eventText.toLowerCase()
  // 姓名只比對全名，不取前綴：取前綴等於只比姓氏，「林董」「林口」都會誤判
  const candidates = [
    ...[contact.nameZh, contact.nameEn].map(n => (n || '').trim()).filter(isDistinctive),
    ...companyTokens(contact.company || ''),
    ...companyTokens(contact.companyEn || ''),
  ]
  return candidates.some(token => text.includes(token.toLowerCase()))
}

/** 一則行程的完整情報區塊；沒有對應人脈時只有行程本身 */
export function formatEventIntel(event: EventLite, matches: ContactIntel[]): string[] {
  const head = `${event.time} ${event.title}${event.location ? ` @ ${event.location}` : ''}`
  if (matches.length === 0) return [head]

  const lines = [head]
  for (const c of matches) {
    const titlePart = c.title ? ` ${c.title}` : ''
    lines.push(`  👤 ${c.name}${titlePart}${c.company ? `（${c.company}）` : ''}`)
    lines.push(`  ⭐ ${c.score}/10 ${c.category}｜${c.status}`)
    if (c.source && c.source !== '其他') {
      lines.push(`  📍 ${c.knownForDays} 天前在「${c.source}」認識`)
    }
    if (c.lastNote) {
      lines.push(`  📝 ${c.lastNote}`)
    }
    if (c.followUpSuggestion) {
      lines.push(`  💡 ${c.followUpSuggestion}`)
    }
  }
  return lines
}

/** 把 notes 陣列最後一則的時間戳前綴拿掉，只留內容 */
export function stripNoteTimestamp(note: string): string {
  return note.replace(/^\[[^\]]*\]\s*/, '').trim()
}

/** 從建檔時間算認識幾天（至少 0） */
export function daysSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86400000))
}
