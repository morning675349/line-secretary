// 名片去重與合併的判斷邏輯。
//
// 比照 lib/event-matching.ts 的做法寫成零 I/O 的純函式，才測得動。
// 碰 Firestore 的那層在 lib/contact-service.ts。
//
// 規則由實測資料定出來（2026-10-29，113 筆）：
//   姓名相同 ＋ 任一電話相同  → 自動合併（命中 4 組）
//   手機相同 ＋ 姓名不同      → 建議，要人判斷（命中 4 組）
//   只有公司電話相同          → 不處理（命中 2 組，全部是誤判）
//
// 最後那條很關鍵。同公司不同人共用總機完全正常，實測那 2 組都是這種情況。
// 把公司電話列入建議會變成永久性的誤判噪音，使用者學會忽略提示之後，
// 真正的重複也會被一起忽略掉。
//
// 反過來，兩個人共用手機幾乎不可能，所以手機撞號值得問。實測那 4 組裡
// 有 2 組明顯是 OCR 一字之差的同一人，另 2 組從資料上看不出來，
// 正是需要人判斷的那種，所以設計成建議而不是自動。

/** 可以參與比對的最小欄位集合，刻意不綁 Contact，純函式才好測 */
export interface MergeCandidate {
  id?: string
  nameZh?: string
  nameEn?: string
  company?: string
  mobile?: string
  officePhone?: string
  source?: string
  notes?: string[]
  status?: string
  score?: number
  cardImageUrl?: string
  createdAt?: { seconds: number }
  mergedInto?: string
}

/**
 * 電話正規化。只留數字，並把 +886 開頭換回 0。
 * 實測同一支號碼在不同名片上出現過國際碼與本地碼兩種寫法。
 */
export function phoneKey(phone?: string): string {
  const d = (phone || '').replace(/\D/g, '')
  if (!d) return ''
  return d.startsWith('886') ? `0${d.slice(3)}` : d
}

/** 姓名正規化。中文名裡的空白是排版造成的，不是內容 */
export function nameKey(c: MergeCandidate): string {
  const raw = c.nameZh || c.nameEn || ''
  return raw.trim().replace(/\s+/g, '').toLowerCase()
}

/**
 * 是不是台灣手機號。只有手機撞號才值得拿來建議合併。
 *
 * 刻意用嚴格的 09 開頭十碼，而不是「不是市話就算手機」。
 * 實測有 2 筆 mobile 欄位是壞資料（一格塞了兩支號碼、OCR 多讀一位變 11 碼），
 * 寬鬆比對會讓這些壞資料去跟別人撞號。
 */
export function isMobileKey(key: string): boolean {
  return /^09\d{8}$/.test(key)
}

export type MergeVerdict = 'auto' | 'suggest' | 'none'

/** 兩筆名片的關係判定。同一筆或已被合併的筆一律回 none */
export function classify(a: MergeCandidate, b: MergeCandidate): MergeVerdict {
  if (!a || !b) return 'none'
  if (a.id && b.id && a.id === b.id) return 'none'
  if (a.mergedInto || b.mergedInto) return 'none'

  const nameA = nameKey(a)
  const nameB = nameKey(b)
  const mobA = phoneKey(a.mobile)
  const mobB = phoneKey(b.mobile)
  const offA = phoneKey(a.officePhone)
  const offB = phoneKey(b.officePhone)

  const samePhone =
    (!!mobA && mobA === mobB) ||
    (!!offA && offA === offB) ||
    // 同一支號碼可能一張名片放在手機欄、另一張放在公司電話欄
    (!!mobA && mobA === offB) ||
    (!!offA && offA === mobB)

  if (nameA && nameA === nameB && samePhone) return 'auto'

  // 建議只看手機，而且兩邊都要是合法手機號
  if (nameA && nameB && nameA !== nameB && isMobileKey(mobA) && mobA === mobB) return 'suggest'

  return 'none'
}

function sec(c: MergeCandidate): number {
  return c.createdAt?.seconds ?? 0
}

/** 新掃的名片要找既有的合併對象 */
export function findMergeTargets(
  incoming: MergeCandidate,
  existing: MergeCandidate[]
): { auto: MergeCandidate | null; suggest: MergeCandidate[] } {
  let auto: MergeCandidate | null = null
  const suggest: MergeCandidate[] = []

  for (const e of existing) {
    const verdict = classify(incoming, e)
    if (verdict === 'auto') {
      // 同時命中多筆時取最早建檔的那筆當主檔，場合與筆記都在它身上
      if (!auto || sec(e) < sec(auto)) auto = e
    } else if (verdict === 'suggest') {
      suggest.push(e)
    }
  }
  return { auto, suggest }
}

export interface DuplicateGroup {
  verdict: 'auto' | 'suggest'
  primary: MergeCandidate
  secondary: MergeCandidate
}

/**
 * 盤點整份名單的重複組合，給「預覽後確認」用。
 *
 * primary 固定取建檔較早的那筆，因為場合、筆記、人工改過的狀態都累積在舊的那筆身上。
 * 實測 4 組自動重複，舊的那筆都有真實場合與一則筆記，新的那筆場合是「其他」且沒有筆記。
 */
export function findDuplicateGroups(all: MergeCandidate[]): DuplicateGroup[] {
  const live = all.filter(c => !c.mergedInto)
  const groups: DuplicateGroup[] = []
  const pairSeen = new Set<string>()

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const verdict = classify(live[i], live[j])
      if (verdict === 'none') continue
      const [primary, secondary] = sec(live[i]) <= sec(live[j]) ? [live[i], live[j]] : [live[j], live[i]]
      const pairId = `${primary.id || i}|${secondary.id || j}`
      if (pairSeen.has(pairId)) continue
      pairSeen.add(pairId)
      groups.push({ verdict, primary, secondary })
    }
  }
  // 自動的排前面，讓預覽清單上「不用你判斷的」先出現
  return groups.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'auto' ? -1 : 1))
}

const STATUS_ORDER = ['待跟進', '已聯絡', '已提案', '成交', '引薦完成']

/** 狀態只能往前走，不能被新掃的名片退回「待跟進」 */
function furtherStatus(a?: string, b?: string): string {
  const ia = STATUS_ORDER.indexOf(a || '')
  const ib = STATUS_ORDER.indexOf(b || '')
  return ib > ia ? (b as string) : (a || '待跟進')
}

export interface MergePlan {
  /** 要寫回 primary 的欄位，空物件代表 primary 已經是完整的 */
  updates: Record<string, unknown>
  /** 給使用者看的人話說明 */
  changes: string[]
}

/**
 * 算出要怎麼把 secondary 併進 primary。只回傳要改的欄位，不做任何寫入。
 *
 * 原則是「不覆蓋既有內容，只補空缺」，因為 primary 可能已經被人工修正過
 * （改過名字、調過評分、補過場合），新掃的那張沒有這些資訊。
 */
export function planMerge(
  primary: MergeCandidate & Record<string, unknown>,
  secondary: MergeCandidate & Record<string, unknown>,
  fillableFields: string[]
): MergePlan {
  const updates: Record<string, unknown> = {}
  const changes: string[] = []

  // 1. 空欄位用 secondary 補
  for (const f of fillableFields) {
    const cur = primary[f]
    const next = secondary[f]
    const curEmpty = cur === undefined || cur === null || cur === '' ||
                     (Array.isArray(cur) && cur.length === 0)
    const nextHas = next !== undefined && next !== null && next !== '' &&
                    !(Array.isArray(next) && next.length === 0)
    if (curEmpty && nextHas) {
      updates[f] = next
      changes.push(`補上 ${f}`)
    }
  }

  // 2. 場合：「其他」等於沒判定出來，可以被真實場合蓋掉
  const pSrc = primary.source || ''
  const sSrc = secondary.source || ''
  if ((!pSrc || pSrc === '其他') && sSrc && sSrc !== '其他') {
    updates.source = sSrc
    changes.push(`場合改成「${sSrc}」`)
  }

  // 3. 筆記兩邊合併，去掉完全重複的句子
  const pNotes = primary.notes || []
  const sNotes = secondary.notes || []
  const addNotes = sNotes.filter(n => !pNotes.includes(n))
  if (addNotes.length) {
    updates.notes = [...pNotes, ...addNotes]
    changes.push(`併入 ${addNotes.length} 則筆記`)
  }

  // 4. 狀態只往前
  const st = furtherStatus(primary.status, secondary.status)
  if (st !== primary.status) {
    updates.status = st
    changes.push(`狀態改成「${st}」`)
  }

  // 5. 另一張名片原圖留著當備份。
  //    兩張同一人的名片等於做過兩次辨識，之後要核對名字時這是唯一的對照來源。
  if (secondary.cardImageUrl && secondary.cardImageUrl !== primary.cardImageUrl) {
    const extras = (primary as { extraCardImages?: string[] }).extraCardImages || []
    if (!extras.includes(secondary.cardImageUrl)) {
      updates.extraCardImages = [...extras, secondary.cardImageUrl]
      changes.push('保留另一張名片原圖')
    }
  }

  return { updates, changes }
}

/** 一組重複在預覽清單上怎麼寫 */
export function describeGroup(g: DuplicateGroup): string {
  const name = (c: MergeCandidate) => c.nameZh || c.nameEn || '（無名）'
  const when = (c: MergeCandidate) =>
    c.createdAt ? new Date(c.createdAt.seconds * 1000)
      .toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }) : '?'
  const tag = g.verdict === 'auto' ? '✅ 同一人' : '❓ 要你判斷'
  const phone = g.primary.mobile || g.primary.officePhone || ''
  return `${tag}　${name(g.primary)}（${when(g.primary)}）＋ ${name(g.secondary)}（${when(g.secondary)}）` +
         `${g.primary.company ? `｜${g.primary.company}` : ''}${phone ? `｜${phone}` : ''}`
}

/**
 * 一組配對的穩定鍵，用來記住「使用者說過這兩筆不是同一人」。
 *
 * 必須跟順序無關：同一組在不同次盤點裡，誰是 primary 可能因為資料被改過而互換，
 * 如果鍵跟順序有關，使用者排除過的組合會再冒出來問第二次。
 * 被問第二次的提示等於沒有記憶，使用者會開始忽略所有提示。
 */
export function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join('|')
}
