// 業務戰情資料層：簽案（deals）與收款（payments）。
// 查詢慣例比照 contact-service：只用 lineUserId 單一 where，其餘全撈進記憶體過濾，
// 不用複合查詢（Firestore 要另建索引，沒建會整支拋錯）。

import { db } from './firebase-admin'
import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { DealLite, PaymentLite, taipeiYm } from './business-progress'

export const DEAL_PRODUCTS = ['網頁', 'SEO年約', '主機維護', '廣告', '其他'] as const
export const DEAL_DELIVERIES = ['內部', '外包', '未定'] as const
export type DealProduct = (typeof DEAL_PRODUCTS)[number]
export type DealDelivery = (typeof DEAL_DELIVERIES)[number]

export interface Deal {
  id?: string
  lineUserId: string
  client: string
  amount: number // 元
  product: DealProduct
  delivery: DealDelivery
  note: string
  signedAt: Timestamp
  voided: boolean
  createdAt: Timestamp
}

export interface Payment {
  id?: string
  lineUserId: string
  client: string
  amount: number
  note: string
  paidAt: Timestamp
  voided: boolean
  createdAt: Timestamp
}

/** 口語日期字串轉 Timestamp；空字串表示今天。無法解析時回 null。 */
export function parseDateOrToday(dateStr: string): Timestamp | null {
  if (!dateStr) return Timestamp.now()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  const d = new Date(`${dateStr}T12:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return null
  return Timestamp.fromDate(d)
}

export async function addDeal(
  lineUserId: string, client: string, amount: number,
  product: DealProduct, delivery: DealDelivery, note: string, signedAt: Timestamp
): Promise<string> {
  const dealDoc: Omit<Deal, 'id'> = {
    lineUserId, client, amount, product, delivery, note,
    signedAt, voided: false, createdAt: Timestamp.now(),
  }
  const ref = await db.collection('deals').add(dealDoc)
  return ref.id
}

export async function addPayment(
  lineUserId: string, client: string, amount: number, note: string, paidAt: Timestamp
): Promise<string> {
  const payDoc: Omit<Payment, 'id'> = {
    lineUserId, client, amount, note,
    paidAt, voided: false, createdAt: Timestamp.now(),
  }
  const ref = await db.collection('payments').add(payDoc)
  return ref.id
}

export async function getDeals(lineUserId: string): Promise<Deal[]> {
  const snap = await db.collection('deals').where('lineUserId', '==', lineUserId).get()
  return snap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Deal))
    .filter(d => !d.voided)
}

export async function getPayments(lineUserId: string): Promise<Payment[]> {
  const snap = await db.collection('payments').where('lineUserId', '==', lineUserId).get()
  return snap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Payment))
    .filter(p => !p.voided)
}

export function toDealLites(deals: Deal[]): DealLite[] {
  return deals.map(d => ({
    amount: d.amount,
    product: d.product,
    delivery: d.delivery,
    signedYm: taipeiYm(d.signedAt.toDate()),
  }))
}

export function toPaymentLites(payments: Payment[]): PaymentLite[] {
  return payments.map(p => ({ amount: p.amount, paidYm: taipeiYm(p.paidAt.toDate()) }))
}

/** 作廢最近一筆符合客戶名的紀錄（軟刪除），回傳被作廢的描述；找不到回 null。 */
export async function voidLatestRecord(
  lineUserId: string, kind: '簽案' | '收款', client: string
): Promise<string | null> {
  const collection = kind === '簽案' ? 'deals' : 'payments'
  const snap = await db.collection(collection).where('lineUserId', '==', lineUserId).get()
  const q = client.toLowerCase()
  const matches = snap.docs
    .map((d: QueryDocumentSnapshot) => ({ id: d.id, ...d.data() } as Deal & Payment))
    .filter(r => !r.voided && r.client.toLowerCase().includes(q))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))

  const target = matches[0]
  if (!target?.id) return null
  await db.collection(collection).doc(target.id).update({ voided: true })
  const dateStr = taipeiYm(
    (kind === '簽案' ? target.signedAt : target.paidAt).toDate()
  )
  return `${target.client}｜${target.amount.toLocaleString()} 元｜${dateStr}`
}
