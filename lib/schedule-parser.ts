import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface ParsedSchedule {
  valid: boolean
  title: string
  startDateTime: string
  endDateTime: string
  location: string
  attendees: string
  errorMessage: string
}

function getWeekInfo(now: Date): string {
  const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const result = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`
    result.push(`${days[d.getDay()]}=${dateStr}`)
  }
  return result.join('，')
}

export async function parseSchedule(text: string): Promise<ParsedSchedule> {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `你是行程解析助手。
今天：${todayStr}，時區 Asia/Taipei（UTC+8）
本週：${getWeekInfo(now)}

從自然語言解析行程，回傳 JSON：
- valid：是否成功解析（布林）
- title：行程標題（簡短）
- startDateTime：ISO 8601 格式，含 +08:00
- endDateTime：ISO 8601，預設1小時後
- location：地點（無則空字串）
- attendees：參與對象（無則空字串）
- errorMessage：解析失敗原因（成功則空字串）

範例輸入：「下週三下午三點跟林董在信義區開會」
範例輸出：{"valid":true,"title":"與林董會議","startDateTime":"2026-06-17T15:00:00+08:00","endDateTime":"2026-06-17T16:00:00+08:00","location":"信義區","attendees":"林董","errorMessage":""}`
      },
      { role: 'user', content: text },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 300,
  })

  return JSON.parse(response.choices[0].message.content || '{}') as ParsedSchedule
}
