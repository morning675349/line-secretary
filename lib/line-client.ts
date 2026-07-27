const LINE_API = 'https://api.line.me/v2/bot'
const LINE_DATA_API = 'https://api-data.line.me/v2/bot'

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
  await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  })
}

export async function pushMessage(userId: string, text: string): Promise<void> {
  await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  })
}

export async function pushAnalysisWithCorrect(userId: string, text: string, contactId: string): Promise<void> {
  await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
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
    }),
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
  await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: 'text',
          text: '📍 這張名片是在哪裡拿到的？',
          quickReply: { items: sourceQuickReplyItems(contactId, '其他場合') },
        },
      ],
    }),
  })
}

/** 已從日曆自動判定場合，顯示結果並附一鍵修改 */
export async function pushSourceDetected(
  userId: string,
  contactId: string,
  text: string
): Promise<void> {
  await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: 'text',
          text,
          quickReply: { items: sourceQuickReplyItems(contactId, '✏️ 不是這個場合') },
        },
      ],
    }),
  })
}
