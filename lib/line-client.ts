const LINE_API = 'https://api.line.me/v2/bot'
const LINE_DATA_API = 'https://api-data.line.me/v2/bot'

export async function downloadLineImage(messageId: string): Promise<Buffer> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  console.log('LINE token prefix:', token?.slice(0, 20))
  console.log('Downloading image messageId:', messageId)

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
          quickReply: {
            items: [
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: 'BNI',
                  data: `src:BNI:${contactId}`,
                  displayText: 'BNI',
                },
              },
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: '轉型創新協會',
                  data: `src:轉型創新協會:${contactId}`,
                  displayText: '轉型創新協會',
                },
              },
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: '製造業採購群',
                  data: `src:製造業採購群:${contactId}`,
                  displayText: '製造業採購群',
                },
              },
              {
                type: 'action',
                action: {
                  type: 'postback',
                  label: '其他場合',
                  data: `src_other:${contactId}`,
                  inputOption: 'openKeyboard',
                  fillInText: '場合名稱：',
                },
              },
            ],
          },
        },
      ],
    }),
  })
}
