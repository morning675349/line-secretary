// 展場模式：在五金展、媒合會這種一次要掃幾十張名片的場合用。
//
// 平常掃一張名片會回三則訊息（分析結果、場合詢問、缺服務項目追問），
// 在攤位上連續掃四十張就是一百多則通知，完全沒辦法用。
// 開啟展場模式後：場合直接套用你宣告的名稱、回覆縮成一行進度、不再逐張追問。

import { db } from './firebase-admin'
import { Timestamp, FieldValue } from 'firebase-admin/firestore'

export interface ExpoMode {
  active: boolean
  source: string
  scanned: number
  startedAt: Timestamp
}

export async function getExpoMode(lineUserId: string): Promise<ExpoMode | null> {
  const doc = await db.collection('users').doc(lineUserId).get()
  const mode = doc.data()?.expoMode as ExpoMode | undefined
  return mode?.active ? mode : null
}

export async function startExpoMode(lineUserId: string, source: string): Promise<void> {
  await db.collection('users').doc(lineUserId).set(
    { expoMode: { active: true, source, scanned: 0, startedAt: Timestamp.now() } },
    { merge: true }
  )
}

/** 結束展場模式，回傳這場總共掃了幾張與場合名稱 */
export async function endExpoMode(lineUserId: string): Promise<{ source: string; scanned: number } | null> {
  const mode = await getExpoMode(lineUserId)
  if (!mode) return null
  await db.collection('users').doc(lineUserId).update({ expoMode: FieldValue.delete() })
  return { source: mode.source, scanned: mode.scanned }
}

/** 掃完一張加一，回傳累計張數 */
export async function bumpExpoCount(lineUserId: string, by = 1): Promise<number> {
  const ref = db.collection('users').doc(lineUserId)
  await ref.update({ 'expoMode.scanned': FieldValue.increment(by) })
  const doc = await ref.get()
  return (doc.data()?.expoMode?.scanned as number) ?? 0
}
