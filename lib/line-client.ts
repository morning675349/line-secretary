const LINE_API = 'https://api.line.me/v2/bot'
const LINE_DATA_API = 'https://api-data.line.me/v2/bot'

/**
 * 統一送出 LINE 訊息並檢查結果。
 *
 * 過去這裡的 fetch 都不看回應，導致 access token 失效時所有訊息靜默消失：
 * 系統看起來一切正常、log 乾乾淨淨，使用者卻完全收不到回覆。
 * 現在失敗會寫 log 並丟出例外，讓上層能決定要不要改用其他管道重送。
 */
async function callLineApi(path: string, payload: unknown): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set')

  const res = await fetch(`${LINE_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const hint = res.status === 401
      ? '（LINE_CHANNEL_ACCESS_TOKEN 已失效，請到 LINE Developers Console 重新發行並更新環境變數）'
      : ''
    const message = `LINE API ${path} failed: ${res.status} ${body}${hint}`
    console.error(message)
    throw new Error(message)
  }
}

/** 驗證 access token 是否仍然有效（健康檢查用） */
export async function verifyLineToken(): Promise<{ ok: boolean; status: number; detail: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, status: 0, detail: 'LINE_CHANNEL_ACCESS_TOKEN is not set' }
  try {
    const res = await fetch(`${LINE_API}/info`, { headers: { Authorization: `Bearer ${token}` } })
    const detail = res.ok ? 'token valid' : (await res.text().catch(() => '')).slice(0, 200)
    return { ok: res.ok, status: res.status, detail }
  } catch (err) {
    return { ok: false, status: 0, detail: String(err) }
  }
}

export async function downloadLineImage(messageId: string): Promise<Buffer> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN

  const res = await fetch(`${LINE_DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LINE image download failed: ${res.status} - ${body}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export async function replyMessage(replyToken: string, text: string): Promise<void> {
  await callLineApi('/message/reply', { replyToken, messages: [{ type: 'text', text }] })
}

export async function pushMessage(userId: string, text: string): Promise<void> {
  await callLineApi('/message/push', { to: userId, messages: [{ type: 'text', text }] })
}

export async function pushAnalysisWithCorrect(userId: string, text: string, contactId: string): Promise<void> {
  await callLineApi('/message/push', {
      to: userId,
      messages: [
        {
          type: 'text',
          text,
          quickReply: {
            items: [
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: '✏️ 修正名字',
                  data: `correct_name:${contactId}`,
                  inputOption: 'closeKeyboard',
                },
              },
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: '✏️ 修正公司',
                  data: `correct_company:${contactId}`,
                  inputOption: 'closeKeyboard',
                },
              },
            ],
          },
        },
      ],
  })
}

// 固定場合選項（自動偵測失敗時的備案，或偵測錯誤時的一鍵覆蓋）
const FIXED_SOURCES = ['BNI', '轉型創新協會', '製造業採購群']

function sourceQuickReplyItems(contactId: string, otherLabel: string) {
  return [
    ...FIXED_SOURCES.map(s => ({
      type: 'action',
      action: { type: 'postback', label: s, data: `src:${s}:${contactId}`, displayText: s },
    })),
    {
      type: 'action',
      action: {
        type: 'postback',
        label: otherLabel,
        data: `src_other:${contactId}`,
        inputOption: 'openKeyboard',
        fillInText: '場合名稱：',
      },
    },
  ]
}

export async function pushSourceQuickReply(userId: string, contactId: string): Promise<void> {
  await callLineApi('/message/push', {
    to: userId,
    messages: [
      {
        type: 'text',
        text: '📍 這張名片是在哪裡拿到的？',
        quickReply: { items: sourceQuickReplyItems(contactId, '其他場合') },
      },
    ],
  })
}

/** 已從日曆自動判定場合，顯示結果並附一鍵修改 */
export async function pushSourceDetected(
  userId: string,
  contactId: string,
  text: string
): Promise<void> {
  await callLineApi('/message/push', {
    to: userId,
    messages: [
      {
        type: 'text',
        text,
        quickReply: { items: sourceQuickReplyItems(contactId, '✏️ 不是這個場合') },
      },
    ],
  })
}
