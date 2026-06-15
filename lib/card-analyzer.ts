import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface CardData {
  name: string
  company: string
  title: string
  phone: string
  email: string
  address: string
  website: string
  score: number
  category: '潛在客戶' | 'BNI夥伴' | 'DobBiz用戶' | '引薦來源' | '待觀察'
  followUpDays: number
  followUpSuggestion: string
  reasoning: string
}

const SYSTEM_PROMPT = `你是一個商業名片分析助手。

關於這位顧問的背景：
- 主要服務：網站規劃（客製化）+ SEO顧問
- 目標客戶：中小企業主、工廠老闆、B2B製造商
- BNI成員：深度參與引薦網絡，需互補型夥伴
- 副業平台：DobBiz（B2B AI採購媒合，目標用戶：製造商、採購商）

評分標準（1-10）：
- 8-10：中小企業/工廠老闆、製造業採購業務（直接客戶或DobBiz用戶）
- 6-7：互補型服務提供者（攝影/印刷/PR/設計/律師/會計）= BNI夥伴
- 4-5：大企業中層主管
- 1-3：與業務無交集

分類規則：
- 潛在客戶：企業主需要網站或SEO
- BNI夥伴：互補型服務，可互相引薦
- DobBiz用戶：製造商或採購商
- 引薦來源：BNI成員或廣泛人脈型人士
- 待觀察：其他

跟進天數：
- 分數7+：3天
- 分數4-6：7天
- 分數1-3：30天

回傳 JSON 格式，欄位：name, company, title, phone, email, address, website, score, category, followUpDays, followUpSuggestion, reasoning。
未識別的欄位填空字串。`

export async function analyzeCard(imageBuffer: Buffer): Promise<CardData> {
  const base64 = imageBuffer.toString('base64')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          },
          { type: 'text', text: '請分析這張名片，萃取所有資訊並評分，回傳 JSON。' },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 800,
  })

  const raw = response.choices[0].message.content || '{}'
  return JSON.parse(raw) as CardData
}

export function formatCardReply(card: CardData, followUpDate: Date): string {
  const scoreBar = '⭐'.repeat(Math.round(card.score / 2))
  const lines = [
    '✅ 名片分析完成！',
    '',
    `👤 ${card.name}`,
    card.title ? `💼 ${card.title}` : '',
    `🏢 ${card.company}`,
    card.phone ? `📱 ${card.phone}` : '',
    card.email ? `📧 ${card.email}` : '',
    card.website ? `🌐 ${card.website}` : '',
    '',
    `${scoreBar} 人脈評分：${card.score}/10`,
    `📌 分類：${card.category}`,
    `💡 ${card.followUpSuggestion}`,
    '',
    `📅 跟進提醒：${followUpDate.toLocaleDateString('zh-TW')}`,
    `（${card.followUpDays}天後）`,
  ]
  return lines.filter(Boolean).join('\n')
}
