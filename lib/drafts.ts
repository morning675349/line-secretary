// 批次起草跟進訊息。
//
// 展場收了四十張名片，一個一個請特助寫就是四十次對話。這支一次產出多封，
// 而且會把現場留的語音筆記餵進去，所以草稿講得出「你提到想找自動化」這種
// 只有當下聊過才知道的細節，這是它跟罐頭開發信的差別。
//
// 一次 API 呼叫產出整批，而不是一人一次呼叫：Hobby 方案函式上限 60 秒，
// 逐一呼叫五封就會逼近上限。

import { openai, AGENT_MODEL } from './ai'

export interface DraftTarget {
  name: string
  company: string
  title: string
  industry: string
  source: string
  isDobBizPotential: boolean
  dobBizNote: string
  followUpSuggestion: string
  notes: string[]
}

export interface Draft {
  name: string
  message: string
}

// 一次最多幾封。LINE 單次推播上限 5 則訊息，剛好對齊，
// 也讓單次 API 呼叫維持在 Hobby 的 60 秒預算內。
export const MAX_DRAFTS_PER_BATCH = 5

const DRAFTS_SCHEMA = {
  type: 'object',
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '對象姓名，必須與輸入完全一致' },
          message: { type: 'string', description: '可直接複製發送的 LINE 訊息' },
        },
        required: ['name', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['drafts'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `你是一位整合行銷顧問的助理，幫主管批次起草展會後的跟進訊息。

主管背景：
- 網站規劃顧問 + SEO 顧問，服務中小企業主、工廠老闆、B2B 製造商
- 經營 DobBiz（B2B AI 採購媒合平台，連結製造商與採購商）

撰寫規則：
- 繁體中文，LINE 訊息語氣，自然、專業、有溫度，不官腔、不推銷感
- 每則 100 字以內，可直接複製發送
- 開頭要點出在哪個場合認識，讓對方立刻想起你是誰
- 若有現場筆記，一定要引用其中的具體內容（那是你們真的聊過的證據），這比任何客套話有效
- 若標記為 DobBiz 潛力，可自然帶出平台，但不要變成硬推銷
- 不要編造沒發生過的互動、不要承諾沒談過的條件
- 每個人的訊息必須不同，不可套用同一個模板換名字`

export async function draftFollowups(targets: DraftTarget[]): Promise<Draft[]> {
  if (targets.length === 0) return []

  const brief = targets.map((t, i) => [
    `【${i + 1}】${t.name}`,
    t.company ? `公司：${t.company}` : '',
    t.title ? `職稱：${t.title}` : '',
    t.industry ? `產業：${t.industry}` : '',
    t.source ? `認識場合：${t.source}` : '',
    t.followUpSuggestion ? `跟進建議：${t.followUpSuggestion}` : '',
    t.isDobBizPotential && t.dobBizNote ? `DobBiz 切入點：${t.dobBizNote}` : '',
    t.notes.length > 0 ? `現場筆記：${t.notes.join('；')}` : '（現場沒有留筆記）',
  ].filter(Boolean).join('\n')).join('\n\n')

  const response = await openai.chat.completions.create({
    model: AGENT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `幫以下 ${targets.length} 位各寫一則跟進訊息：\n\n${brief}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'followup_drafts', strict: true, schema: DRAFTS_SCHEMA },
    },
  })

  const raw = response.choices[0].message.content
  if (!raw) throw new Error('草稿生成沒有回傳內容')
  const parsed = JSON.parse(raw) as { drafts: Draft[] }
  return parsed.drafts ?? []
}
