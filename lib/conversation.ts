import { db } from './firebase-admin'

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

// 對話記憶：每個 LINE 使用者一份，存最近的往返讓 agent 能接住「他的電話多少？」這類追問。
// 超過 MAX_AGE 的訊息視為過期，不帶入 context，避免昨天的話題污染今天的請求。
const MAX_TURNS = 12
const MAX_AGE_MS = 6 * 60 * 60 * 1000 // 6 小時

function ref(lineUserId: string) {
  return db.collection('conversations').doc(lineUserId)
}

export async function getHistory(lineUserId: string): Promise<ConversationTurn[]> {
  const doc = await ref(lineUserId).get()
  const turns: ConversationTurn[] = doc.data()?.turns || []
  const cutoff = Date.now() - MAX_AGE_MS
  return turns.filter(t => t.ts >= cutoff).slice(-MAX_TURNS)
}

export async function appendExchange(lineUserId: string, userText: string, assistantText: string): Promise<void> {
  const doc = await ref(lineUserId).get()
  const turns: ConversationTurn[] = doc.data()?.turns || []
  const now = Date.now()
  turns.push({ role: 'user', content: userText, ts: now })
  turns.push({ role: 'assistant', content: assistantText, ts: now })
  await ref(lineUserId).set({ turns: turns.slice(-MAX_TURNS * 2) })
}

// 系統動作（掃名片、按鈕）也寫進記憶，讓 agent 知道剛剛發生什麼事
export async function appendSystemNote(lineUserId: string, note: string): Promise<void> {
  const doc = await ref(lineUserId).get()
  const turns: ConversationTurn[] = doc.data()?.turns || []
  const now = Date.now()
  turns.push({ role: 'user', content: `（系統事件）${note}`, ts: now })
  turns.push({ role: 'assistant', content: '好的，我記住了。', ts: now })
  await ref(lineUserId).set({ turns: turns.slice(-MAX_TURNS * 2) })
}
