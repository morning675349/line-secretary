import { db } from './firebase-admin'
import { CardData } from './card-analyzer'
import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore'

export interface Contact extends CardData {
  id?: string
  lineUserId: string
  status: '待跟進' | '已聯絡' | '已提案' | '成交' | '引薦完成'
  source: 'BNI' | '展覽活動' | '客戶介紹' | '社群' | '其他'
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
    .where('status', '==', '待跟進')
    .where('followUpAt', '<=', now)
    .orderBy('followUpAt')
    .limit(5)
    .get()

  return snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Contact))
}

export async function updateContactStatus(
  contactId: string,
  status: Contact['status']
): Promise<void> {
  await db.collection('contacts').doc(contactId).update({ status })
}

export async function updateContactSource(
  contactId: string,
  source: Contact['source']
): Promise<void> {
  await db.collection('contacts').doc(contactId).update({ source })
}

export async function searchContacts(lineUserId: string, query: string): Promise<Contact[]> {
  const snap = await db
    .collection('contacts')
    .where('lineUserId', '==', lineUserId)
    .orderBy('score', 'desc')
    .limit(20)
    .get()

  const contacts = snap.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Contact))
  const q = query.toLowerCase()
  return contacts.filter(
    (c: Contact) =>
      c.nameZh?.includes(q) ||
      c.nameEn?.toLowerCase().includes(q) ||
      c.company?.includes(q) ||
      c.companyEn?.toLowerCase().includes(q) ||
      c.category?.includes(q) ||
      c.title?.includes(q)
  )
}
