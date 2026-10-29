// 把例外寫進 Firestore，讓失敗原因不必靠 Vercel log 才看得到。
//
// 由來：這個專案被「看不見的失敗」咬過三次。
//   1. 2026-07-27 LINE token 失效，站台 200、webhook 200，唯一症狀是收不到回覆
//   2. 早報因為缺複合索引，從上線起無聲失敗好幾個月
//   3. 2026-10-29 掃名片回「發生錯誤」，但本機沒有正式環境的 token，重現不了
// 第三次之所以難查，是因為錯誤只進了 console.error，而 console 只有 Vercel 看得到。
//
// 寫入刻意 fail open：記錯誤本身絕對不能把主流程再弄壞一次。

import { db } from './firebase-admin'
import { Timestamp } from 'firebase-admin/firestore'

const COLLECTION = 'error_logs'
const RETENTION_DAYS = 14

/** 例外轉成可讀字串，Error 之外的東西（字串、物件）也要撈得出內容 */
function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return { message: err.message.slice(0, 2000), stack: (err.stack || '').slice(0, 4000) }
  }
  try {
    return { message: JSON.stringify(err).slice(0, 2000), stack: '' }
  } catch {
    return { message: String(err).slice(0, 2000), stack: '' }
  }
}

/**
 * 記一筆錯誤。where 用來標出是哪個環節（例如 'scan.pushFlex'）。
 * extra 放當下的關鍵資料，方便事後重建情境，不要放個資以外用不到的東西。
 */
export async function logError(where: string, err: unknown, extra?: Record<string, unknown>) {
  const { message, stack } = describe(err)
  console.error(`[${where}]`, message)
  try {
    await db.collection(COLLECTION).add({
      where,
      message,
      stack,
      extra: extra ?? {},
      createdAt: Timestamp.now(),
    })
  } catch (inner) {
    // 記錯誤失敗就只剩 console，但主流程照走
    console.error('logError 本身失敗:', inner)
  }
}

/** 清掉過期紀錄，由每日 cron 呼叫 */
export async function purgeOldErrorLogs(): Promise<number> {
  const cutoff = Timestamp.fromMillis(Date.now() - RETENTION_DAYS * 86400_000)
  const snap = await db.collection(COLLECTION).where('createdAt', '<', cutoff).get()
  await Promise.all(snap.docs.map(d => d.ref.delete()))
  return snap.size
}
