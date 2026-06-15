const LINE_API = 'https://api.line.me/v2/bot'

export async function downloadLineImage(messageId: string): Promise<Buffer> {
  const res = await fetch(`${LINE_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
  })
  if (!res.ok) throw new Error(`LINE image download failed: ${res.status}`)
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
