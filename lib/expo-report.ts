// 展後戰果報告：把一疊名片變成「先打給誰」的行動清單。
//
// 設攤成本很高（攤位費、三天人力、交通），收完名片才是投資回收的起點。
// 這支的工作是回答三個問題：這場收穫如何、哪幾個要先跟、誰能直接寄開發信。
//
// 純函式無 I/O，方便單獨驗證排序邏輯。

export interface ExpoContactLite {
  id: string
  name: string
  company: string
  score: number
  industry: string
  isDobBizPotential: boolean
  noteCount: number
  hasEmail: boolean
}

export interface RankedContact extends ExpoContactLite {
  priority: number
  reasons: string[]
}

export type Tier = 'A' | 'B' | 'C'

export function tierOf(score: number): Tier {
  if (score >= 8) return 'A'
  if (score >= 6) return 'B'
  return 'C'
}

/**
 * 跟進優先序。
 *
 * 「現場留過語音筆記」給最高加權是刻意的：那代表你真的停下來聊過，
 * 對方的意願訊號比名片本身的評分更可信。單純路過拿名片不會有筆記。
 */
export function rankExpoContacts(contacts: ExpoContactLite[]): RankedContact[] {
  return contacts
    .map(c => {
      const reasons: string[] = []
      let priority = c.score
      if (c.noteCount > 0) { priority += 3; reasons.push('現場聊過') }
      if (c.isDobBizPotential) { priority += 2; reasons.push('DobBiz 潛力') }
      if (c.hasEmail) { priority += 1 }
      return { ...c, priority, reasons }
    })
    .sort((a, b) => b.priority - a.priority || b.score - a.score)
}

function countBy<T>(items: T[], key: (t: T) => string): Array<[string, number]> {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item) || '未分類'
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

export function buildExpoReport(source: string, contacts: ExpoContactLite[]): string {
  if (contacts.length === 0) {
    return `🎪 ${source}\n\n這個場合目前沒有任何名片紀錄。`
  }

  const ranked = rankExpoContacts(contacts)
  const tiers = { A: 0, B: 0, C: 0 }
  for (const c of contacts) tiers[tierOf(c.score)]++

  const talked = contacts.filter(c => c.noteCount > 0).length
  const dobBiz = contacts.filter(c => c.isDobBizPotential).length
  const withEmail = contacts.filter(c => c.hasEmail).length

  const lines: string[] = [
    `🎪 ${source} 戰果報告`,
    `共 ${contacts.length} 張名片`,
    '',
    `🥇 A 級 ${tiers.A} 位｜🥈 B 級 ${tiers.B} 位｜🥉 C 級 ${tiers.C} 位`,
  ]

  if (talked > 0) lines.push(`💬 現場聊過（有留筆記）${talked} 位`)
  if (dobBiz > 0) lines.push(`🔗 DobBiz 潛力 ${dobBiz} 位`)
  lines.push(`📧 有 Email 可寄開發信 ${withEmail} 位`)
  lines.push('')

  const industries = countBy(contacts, c => c.industry).slice(0, 5)
  if (industries.length > 0) {
    lines.push('🏭 產業分佈')
    for (const [name, n] of industries) lines.push(`  ・${name} ${n}`)
    lines.push('')
  }

  lines.push('🎯 建議跟進順序')
  ranked.slice(0, 5).forEach((c, i) => {
    const tail = c.reasons.length > 0 ? `・${c.reasons.join('・')}` : ''
    lines.push(`  ${i + 1}. ${c.name}${c.company ? `（${c.company}）` : ''} ⭐${c.score} ${tail}`)
  })
  lines.push('')

  lines.push('下一步可以說：')
  lines.push(`「${source} A 級名單各寫一封跟進訊息」`)
  lines.push(`「匯出 ${source} 名單」`)

  return lines.join('\n')
}
