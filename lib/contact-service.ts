import { db } from './firebase-admin'
import { CardData } from './card-analyzer'
import { Timestamp, QueryDocumentSnapshot, FieldValue } from 'firebase-admin/firestore'

export interface Contact extends CardData {
  id?: string
  lineUserId: string
  status: '待跟進' | '已聯絡' | '已提案' | '成交' | '引薦完成'
  source: string
  notes: string[]
  followUpAt: Timestamp
  createdAt: Timestamp
}

export async function saveContact(lineUserId: string, card: CardData): Promise<string> {
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
  }

  const ref = await db.collection('contacts').add(contact)
  return ref.id
}

export async function getPendingFollowUps(lineUserId: string): Promise<Contact[]> {
  const now = Timestamp.now()
  const snap = await db
    .collection('contacts')
    .where('lineUserId', '==', lineUserId)
    .get()

  return snap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Contact))
    .filter(c => c.status === '待跟進' && c.followUpAt && c.followUpAt <= now)
    .sort((a, b) => a.followUpAt.seconds - b.followUpAt.seconds)
    .slice(0, 5)
}

export async function updateContactStatus(contactId: string, status: Contact['status']): Promise<void> {
  await db.collection('contacts').doc(contactId).update({ status })
}

export async function updateContactSource(contactId: string, source: string): Promise<void> {
  await db.collection('contacts').doc(contactId).update({ source })
}

export async function updateContactField(
  contactId: string,
  field: 'nameZh' | 'nameEn' | 'company' | 'companyEn',
  value: string
): Promise<void> {
  await db.collection('contacts').doc(contactId).update({ [field]: value })
}

export async function addContactNote(contactId: string, note: string): Promise<void> {
  const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  await db.collection('contacts').doc(contactId).update({
    notes: FieldValue.arrayUnion(`[${timestamp}] ${note}`),
  })
}

// 搜尋聯絡人（支援模糊匹配姓名/公司）
export async function searchContacts(lineUserId: string, query: string): Promise<Contact[]> {
  const snap = await db
    .collection('contacts')
    .where('lineUserId', '==', lineUserId)
    .get()

  const contacts = snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Contact))
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

// 取得最近一筆聯絡人（場合輸入時的 fallback）
export async function getLatestContact(lineUserId: string): Promise<Contact | null> {
  const snap = await db.collection('contacts').where('lineUserId', '==', lineUserId).get()
  const contacts = snap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Contact))
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
  const snap = await db
    .collection('contacts')
    .where('lineUserId', '==', lineUserId)
    .get()

  const contacts = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as Contact)

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
