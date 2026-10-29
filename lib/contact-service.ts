import { db } from './firebase-admin'
import { CardData } from './card-analyzer'
import { Timestamp, QueryDocumentSnapshot, FieldValue } from 'firebase-admin/firestore'
import { findMergeTargets, findDuplicateGroups, planMerge, pairKey } from './contact-merge'
import type { MergeCandidate, DuplicateGroup } from './contact-merge'

export interface Contact extends CardData {
  id?: string
  lineUserId: string
  status: '待跟進' | '已聯絡' | '已提案' | '成交' | '引薦完成'
  source: string
  notes: string[]
  followUpAt: Timestamp
  createdAt: Timestamp
  cardImageUrl?: string
  /** 另一張同一人的名片原圖，合併時留下來當核對用的對照 */
  extraCardImages?: string[]
  /** 被併進哪一筆。有值就代表這筆已經不是活的，所有查詢都要排除 */
  mergedInto?: string
  mergedAt?: Timestamp
}

/**
 * 合併時可以「補空缺」的欄位。
 *
 * 刻意不含 score、category、followUpDays、status 這些可能被人工調整過的欄位，
 * 也不含 createdAt。原則是新掃的那張只能補 primary 沒有的東西，不能改它已有的判斷。
 */
const MERGE_FILLABLE_FIELDS = [
  'nameZh', 'nameEn', 'company', 'companyEn', 'title', 'titleEn',
  'mobile', 'officePhone', 'fax', 'email', 'address', 'website',
  'services', 'industry', 'companySize', 'dobBizNote', 'followUpSuggestion',
  'cardImageUrl',
]

/**
 * 所有「撈整份名單」的查詢都要走這裡。
 *
 * 合併後的筆必須排除，否則匯出名單會重複寄信、統計會多算。
 * 集中在一處是刻意的：讓每個查詢各自寫排除條件，漏掉一處就會有已合併的
 * 名片在某個畫面上冒出來，而且很難發現是哪一個查詢漏了。
 *
 * 用記憶體過濾而不是 where 條件，因為 Firestore 的 where 不會命中
 * 「欄位不存在」的文件（合併前建的名片都沒有 mergedInto 這個欄位），
 * 而且加了 where 就會需要複合索引（見 CLAUDE.md 的資料層地雷）。
 */
async function fetchUserContacts(lineUserId: string): Promise<Contact[]> {
  const snap = await db.collection('contacts').where('lineUserId', '==', lineUserId).get()
  return snap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Contact))
    .filter(c => !c.mergedInto)
}

export async function saveContact(lineUserId: string, card: CardData, cardImageUrl?: string): Promise<string> {
  const followUpAt = new Date()
  followUpAt.setDate(followUpAt.getDate() + card.followUpDays)

  const contact: Omit<Contact, 'id'> = {
    ...card,
    lineUserId,
    status: '待跟進',
    source: '其他',
    notes: [],
    followUpAt: Timestamp.fromDate(followUpAt),
    createdAt: Timestamp.now(),
    ...(cardImageUrl ? { cardImageUrl } : {}),
  }

  const ref = await db.collection('contacts').add(contact)
  return ref.id
}

/** 取出這個使用者的所有聯絡人（早報、週報這種要全域盤點的場景用） */
export async function getAllContacts(lineUserId: string): Promise<Contact[]> {
  return fetchUserContacts(lineUserId)
}

export async function getPendingFollowUps(lineUserId: string): Promise<Contact[]> {
  const now = Timestamp.now()
  return (await fetchUserContacts(lineUserId))
    .filter(c => c.status === '待跟進' && c.followUpAt && c.followUpAt <= now)
    .sort((a, b) => a.followUpAt.seconds - b.followUpAt.seconds)
    .slice(0, 5)
}

// 驗證 contactId 確實屬於這個 LINE 使用者，避免任何人透過猜測/取得 contactId
// 就能修改別人的聯絡人資料（IDOR）。所有由使用者輸入（文字指令/postback）
// 直接帶入 contactId 的寫入動作，都必須先通過這層檢查。
async function assertOwnership(lineUserId: string, contactId: string): Promise<boolean> {
  const doc = await db.collection('contacts').doc(contactId).get()
  return doc.exists && doc.data()?.lineUserId === lineUserId
}

export async function updateContactStatus(lineUserId: string, contactId: string, status: Contact['status']): Promise<boolean> {
  if (!(await assertOwnership(lineUserId, contactId))) return false
  await db.collection('contacts').doc(contactId).update({ status })
  return true
}

export async function updateContactSource(lineUserId: string, contactId: string, source: string): Promise<boolean> {
  if (!(await assertOwnership(lineUserId, contactId))) return false
  await db.collection('contacts').doc(contactId).update({ source })
  return true
}

export async function updateContactField(
  lineUserId: string,
  contactId: string,
  field: 'nameZh' | 'nameEn' | 'company' | 'companyEn',
  value: string
): Promise<boolean> {
  if (!(await assertOwnership(lineUserId, contactId))) return false
  await db.collection('contacts').doc(contactId).update({ [field]: value })
  return true
}

export async function addContactNote(lineUserId: string, contactId: string, note: string): Promise<boolean> {
  if (!(await assertOwnership(lineUserId, contactId))) return false
  const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  await db.collection('contacts').doc(contactId).update({
    notes: FieldValue.arrayUnion(`[${timestamp}] ${note}`),
  })
  return true
}

// 搜尋聯絡人（支援模糊匹配姓名/公司）
export async function searchContacts(lineUserId: string, query: string): Promise<Contact[]> {
  const contacts = await fetchUserContacts(lineUserId)
  const q = query.toLowerCase()
  return contacts
    .filter(
      (c: Contact) =>
        c.nameZh?.toLowerCase().includes(q) ||
        c.nameEn?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.companyEn?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q)
    )
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
}

/** 不跟合併指標走的原始讀取，合併流程自己要看被併掉的那筆時用 */
async function getContactRaw(lineUserId: string, contactId: string): Promise<Contact | null> {
  const doc = await db.collection('contacts').doc(contactId).get()
  if (!doc.exists || doc.data()?.lineUserId !== lineUserId) return null
  return { id: doc.id, ...doc.data() } as Contact
}

/**
 * 依 id 取單一聯絡人，含擁有權檢查（卡片按鈕帶 contactId 進來時用）。
 *
 * 會跟著 mergedInto 走一層。合併之前送出的卡片還留在對話記錄裡，
 * 使用者幾天後翻上去按「標記已聯絡」時，要改到活著的那筆，不是已被併掉的那筆。
 * 只走一層就夠：合併一律併進最早建檔的那筆，不會形成鏈。
 */
export async function getContactById(lineUserId: string, contactId: string): Promise<Contact | null> {
  const first = await getContactRaw(lineUserId, contactId)
  if (!first) return null
  if (!first.mergedInto) return first
  return getContactRaw(lineUserId, first.mergedInto)
}

// 依姓名或公司找單一聯絡人（用於狀態更新）
export async function findContactByName(lineUserId: string, name: string): Promise<Contact | null> {
  const results = await searchContacts(lineUserId, name)
  return results[0] || null
}

// 暫存「其他場合」等待用戶輸入
export async function setPendingSource(lineUserId: string, contactId: string): Promise<void> {
  await db.collection('users').doc(lineUserId).set({ pendingSource: contactId }, { merge: true })
}

export async function consumePendingSource(lineUserId: string): Promise<string | null> {
  const doc = await db.collection('users').doc(lineUserId).get()
  const contactId = doc.data()?.pendingSource || null
  if (contactId) {
    await db.collection('users').doc(lineUserId).update({ pendingSource: FieldValue.delete() })
  }
  return contactId
}

// 暫存「等待修正名字/公司」
export async function setPendingCorrection(lineUserId: string, field: 'nameZh' | 'nameEn' | 'company' | 'companyEn', contactId: string): Promise<void> {
  await db.collection('users').doc(lineUserId).set({ pendingCorrection: { field, contactId } }, { merge: true })
}

export async function consumePendingCorrection(lineUserId: string): Promise<{ field: 'nameZh' | 'nameEn' | 'company' | 'companyEn'; contactId: string } | null> {
  const doc = await db.collection('users').doc(lineUserId).get()
  const data = doc.data()?.pendingCorrection || null
  if (data) {
    await db.collection('users').doc(lineUserId).update({ pendingCorrection: FieldValue.delete() })
  }
  return data
}

// 暫存「等待補充服務項目」
export async function setPendingNote(lineUserId: string, contactId: string): Promise<void> {
  await db.collection('users').doc(lineUserId).set({ pendingNote: contactId }, { merge: true })
}

export async function consumePendingNote(lineUserId: string): Promise<string | null> {
  const doc = await db.collection('users').doc(lineUserId).get()
  const contactId = doc.data()?.pendingNote || null
  if (contactId) {
    await db.collection('users').doc(lineUserId).update({ pendingNote: FieldValue.delete() })
  }
  return contactId
}

// ── 場合回補 ────────────────────────────────────────────────
// 舊名片的 source 多半停在預設的「其他」，可用建檔時間反查當天日曆補回去。

export interface BackfillItem {
  contactId: string
  name: string
  company: string
  source: string
}

/** 找出場合還沒填實的聯絡人（預設值「其他」或空白） */
export async function getContactsNeedingSource(lineUserId: string): Promise<Contact[]> {
  return (await fetchUserContacts(lineUserId))
    .filter(c => !c.source || c.source === '其他')
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
}

export async function setPendingBackfill(lineUserId: string, items: BackfillItem[]): Promise<void> {
  await db.collection('users').doc(lineUserId).set({ pendingBackfill: items }, { merge: true })
}

export async function consumePendingBackfill(lineUserId: string): Promise<BackfillItem[] | null> {
  const doc = await db.collection('users').doc(lineUserId).get()
  const items = doc.data()?.pendingBackfill as BackfillItem[] | undefined
  if (!items?.length) return null
  await db.collection('users').doc(lineUserId).update({ pendingBackfill: FieldValue.delete() })
  return items
}

/**
 * 取出某個場合的所有聯絡人。
 * 用包含比對而非完全相等，因為日曆事件名可能是「五金展 TiTE x IHT」，
 * 但使用者口語只會說「五金展」。
 */
export async function getContactsBySource(lineUserId: string, source: string): Promise<Contact[]> {
  const all = await getAllContacts(lineUserId)
  const q = source.trim().toLowerCase()
  if (!q) return []
  return all
    .filter(c => (c.source || '').toLowerCase().includes(q))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
}

// 取得最近一筆聯絡人（場合輸入時的 fallback）
export async function getLatestContact(lineUserId: string): Promise<Contact | null> {
  const contacts = (await fetchUserContacts(lineUserId))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
  return contacts[0] || null
}

// 統計
export interface ContactStats {
  total: number
  byCategory: Record<string, number>
  byIndustry: Record<string, number>
  byStatus: Record<string, number>
  dobBizCount: number
  thisWeekNew: number
}

export async function getContactStats(lineUserId: string): Promise<ContactStats> {
  const contacts = await fetchUserContacts(lineUserId)

  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  const weekAgoTs = Timestamp.fromDate(oneWeekAgo)

  const stats: ContactStats = {
    total: contacts.length,
    byCategory: {},
    byIndustry: {},
    byStatus: {},
    dobBizCount: 0,
    thisWeekNew: 0,
  }

  for (const c of contacts) {
    stats.byCategory[c.category] = (stats.byCategory[c.category] || 0) + 1
    if (c.industry) stats.byIndustry[c.industry] = (stats.byIndustry[c.industry] || 0) + 1
    stats.byStatus[c.status] = (stats.byStatus[c.status] || 0) + 1
    if (c.isDobBizPotential) stats.dobBizCount++
    if (c.createdAt && c.createdAt >= weekAgoTs) stats.thisWeekNew++
  }

  return stats
}

// ── 名片合併 ──────────────────────────────────────────────
//
// 規則與判斷邏輯在 lib/contact-merge.ts（純函式，有測試）。
// 這一層只負責讀寫 Firestore。
//
// 合併一律是「軟刪除」：被併掉的那筆留在資料庫，加上 mergedInto 指向主檔。
// 比照 lib/deal-service.ts 的 voided 做法。判斷錯了要還原得回來，
// 而且名片原圖與當初的筆記都還在。

/**
 * 新掃的名片要不要併進既有的某一筆。
 *
 * selfId 一定要傳，而且一定要排除掉。
 * 這支是在 saveContact 之後呼叫的，所以候選名單裡包含剛建好的那一筆，
 * 它跟自己姓名電話完全相同，不排除的話 auto 永遠有值，
 * 連帶讓「手機撞號但姓名不同」的建議永遠不會出現（suggest 的條件是沒有 auto）。
 */
export async function findMergeForNewCard(
  lineUserId: string,
  card: CardData,
  selfId: string
): Promise<{ auto: Contact | null; suggest: Contact[] }> {
  const existing = (await fetchUserContacts(lineUserId)).filter(c => c.id !== selfId)
  const incoming: MergeCandidate = {
    id: selfId,
    nameZh: card.nameZh, nameEn: card.nameEn, company: card.company,
    mobile: card.mobile, officePhone: card.officePhone,
  }
  const { auto, suggest } = findMergeTargets(incoming, existing as MergeCandidate[])
  return { auto: (auto as Contact) || null, suggest: suggest as Contact[] }
}

export interface MergeResult {
  ok: boolean
  changes: string[]
  /** 合併後活著的那筆 id */
  survivingId: string
  reason?: string
}

/**
 * 把 secondaryId 併進 primaryId。
 *
 * 兩筆都要通過擁有權檢查，因為 contactId 是從 postback 進來的使用者輸入，
 * 少檢查一邊就等於開了一個可以改別人資料的洞（IDOR）。
 */
export async function mergeContactPair(
  lineUserId: string,
  primaryId: string,
  secondaryId: string
): Promise<MergeResult> {
  if (primaryId === secondaryId) {
    return { ok: false, changes: [], survivingId: primaryId, reason: '同一筆名片' }
  }
  const [primary, secondary] = await Promise.all([
    getContactRaw(lineUserId, primaryId),
    getContactRaw(lineUserId, secondaryId),
  ])
  if (!primary || !secondary) {
    return { ok: false, changes: [], survivingId: primaryId, reason: '找不到名片' }
  }
  if (secondary.mergedInto) {
    return { ok: false, changes: [], survivingId: primaryId, reason: '這筆已經合併過了' }
  }
  if (primary.mergedInto) {
    return { ok: false, changes: [], survivingId: primary.mergedInto, reason: '主檔已經被併到別筆' }
  }

  const { updates, changes } = planMerge(
    primary as never,
    secondary as never,
    MERGE_FILLABLE_FIELDS
  )

  if (Object.keys(updates).length) {
    await db.collection('contacts').doc(primaryId).update(updates)
  }
  await db.collection('contacts').doc(secondaryId).update({
    mergedInto: primaryId,
    mergedAt: Timestamp.now(),
  })

  return { ok: true, changes, survivingId: primaryId }
}

/** 還原一次合併，判斷錯的時候用 */
export async function unmergeContact(lineUserId: string, contactId: string): Promise<boolean> {
  const doc = await getContactRaw(lineUserId, contactId)
  if (!doc?.mergedInto) return false
  await db.collection('contacts').doc(contactId).update({
    mergedInto: FieldValue.delete(),
    mergedAt: FieldValue.delete(),
  })
  return true
}

/**
 * 盤點既有名單的重複組合，給「預覽後確認」的第一段用。
 *
 * 會排除使用者按過「不是同一人」的組合。不排除的話每次檢查都會再問一次，
 * 被問第二次的提示等於沒有記憶，使用者會開始忽略所有提示，
 * 真正的重複也跟著被忽略。
 */
export async function previewDuplicates(lineUserId: string): Promise<DuplicateGroup[]> {
  const [all, dismissed] = await Promise.all([
    fetchUserContacts(lineUserId),
    getDismissedPairs(lineUserId),
  ])
  return findDuplicateGroups(all as MergeCandidate[])
    .filter(g => !dismissed.has(pairKey(g.primary.id || '', g.secondary.id || '')))
}

/** 使用者按過「不是同一人」的組合 */
export async function getDismissedPairs(lineUserId: string): Promise<Set<string>> {
  const doc = await db.collection('users').doc(lineUserId).get()
  return new Set((doc.data()?.dismissedMergePairs as string[] | undefined) || [])
}

/**
 * 記住這兩筆不是同一人。
 *
 * 只檢查擁有權不檢查是否真的相似：使用者說不是就不是，不需要系統同意。
 */
export async function dismissMergePair(
  lineUserId: string,
  idA: string,
  idB: string
): Promise<boolean> {
  const [a, b] = await Promise.all([
    assertOwnership(lineUserId, idA),
    assertOwnership(lineUserId, idB),
  ])
  if (!a || !b) return false
  await db.collection('users').doc(lineUserId).set(
    { dismissedMergePairs: FieldValue.arrayUnion(pairKey(idA, idB)) },
    { merge: true }
  )
  return true
}

export interface PendingMerge {
  primaryId: string
  secondaryId: string
  label: string
  verdict: 'auto' | 'suggest'
}

/** 暫存待確認的合併提案，比照 pendingBackfill 的做法 */
export async function setPendingMerges(lineUserId: string, pairs: PendingMerge[]): Promise<void> {
  await db.collection('users').doc(lineUserId).set({ pendingMerges: pairs }, { merge: true })
}

/** 只讀不清掉，因為使用者可能分幾次合併（先處理確定的，再慢慢判斷其他的） */
export async function getPendingMerges(lineUserId: string): Promise<PendingMerge[]> {
  const doc = await db.collection('users').doc(lineUserId).get()
  return (doc.data()?.pendingMerges as PendingMerge[] | undefined) || []
}

export async function clearPendingMerges(lineUserId: string): Promise<void> {
  await db.collection('users').doc(lineUserId).update({ pendingMerges: FieldValue.delete() })
}

/**
 * 重排跟進日期。
 *
 * 只有「又遇到同一個人」時才該呼叫，也就是掃到重複名片的那一刻。
 * 舊資料清理（apply_duplicate_merges）不可以用這支，那只是整理資料，
 * 不代表剛見過面，把跟進日期往後推會讓真正該跟進的人從名單上消失。
 */
export async function refreshFollowUp(
  lineUserId: string,
  contactId: string,
  days: number
): Promise<boolean> {
  if (!(await assertOwnership(lineUserId, contactId))) return false
  const followUpAt = new Date()
  followUpAt.setDate(followUpAt.getDate() + days)
  await db.collection('contacts').doc(contactId).update({ followUpAt: Timestamp.fromDate(followUpAt) })
  return true
}
