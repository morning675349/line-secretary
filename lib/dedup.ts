// LINE webhook 事件去重。
//
// LINE 在沒收到 200 或回應太慢時會重送同一批事件。名片掃描一次要 10 秒以上，
// 展場連續掃時很容易踩到重送，結果就是同一張名片建了兩三筆聯絡人。
// 這裡用 Firestore 的 create()（文件已存在就拋錯）當作原子性的「認領」動作。

import { db } from './firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'

const COLLECTION = 'processed_events'
const RETENTION_DAYS = 3

/**
 * 嘗試認領一個事件。回傳 true 代表這次是第一次處理，false 代表先前已處理過。
 *
 * 認領失敗時一律回 false（寧可漏處理也不要重複建檔），
 * 但如果是 Firestore 本身出錯，會回 true 讓流程繼續，避免整個 bot 因去重機制掛掉。
 */
export async function claimEvent(eventId: string): Promise<boolean> {
  if (!eventId) return true
  try {
    await db.collection(COLLECTION).doc(eventId).create({ at: Timestamp.now() })
    return true
  } catch (err) {
    const message = String(err)
    if (message.includes('ALREADY_EXISTS') || message.includes('already exists')) {
      console.warn(`Duplicate LINE event skipped: ${eventId}`)
      return false
    }
    console.error('claimEvent failed, processing anyway:', err)
    return true
  }
}

/** 清掉過期的去重紀錄，避免集合無限成長。由每日 cron 呼叫，失敗不影響主流程。 */
export async function pruneProcessedEvents(): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - RETENTION_DAYS * 86400000)
  const snap = await db.collection(COLLECTION).where('at', '<', cutoff).limit(400).get()
  if (snap.empty) return 0
  const batch = db.collection(COLLECTION).firestore.batch()
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
  return snap.size
}
