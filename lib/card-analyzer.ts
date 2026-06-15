import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface CardData {
  nameZh: string
  nameEn: string
  company: string
  companyEn: string
  title: string
  titleEn: string
  mobile: string
  officePhone: string
  fax: string
  email: string
  address: string
  website: string
  score: number
  category: '潛在客戶' | 'BNI夥伴' | 'DobBiz用戶' | '引薦來源' | '待觀察'
  followUpDays: number
  followUpSuggestion: string
  reasoning: string
}

const SYSTEM_PROMPT = `你是一個商業名片 OCR 與分析助手，請仔細辨識名片上每一個字，特別注意相似漢字。

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

回傳 JSON，欄位說明：
- nameZh：中文姓名（沒有則空字串）
- nameEn：英文姓名（沒有則空字串）
- company：公司中文名稱（仔細辨識每個字）
- companyEn：公司英文名稱（沒有則空字串）
- title：職稱中文
- titleEn：職稱英文（沒有則空字串）
- mobile：手機號碼（沒有則空字串）
- officePhone：公司電話（沒有則空字串）
- fax：傳真（沒有則空字串）
- email：電子郵件
- address：地址
- website：網站
- score：評分 1-10
- category：分類
- followUpDays：跟進天數
- followUpSuggestion：具體跟進建議（一句話）
- reasoning：評分理由（一句話）

未識別的欄位填空字串。`

export async function analyzeCard(imageBuffer: Buffer): Promise<CardData> {
  const base64 = imageBuffer.toString('base64')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          },
          { type: 'text', text: '請仔細辨識名片上所有資訊，回傳完整 JSON。' },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1000,
  })

  const raw = response.choices[0].message.content || '{}'
  return JSON.parse(raw) as CardData
}

export function formatCardReply(card: CardData, followUpDate: Date): string {
  const scoreBar = '⭐'.repeat(Math.round(card.score / 2))

  const nameLine = [card.nameZh, card.nameEn].filter(Boolean).join('  ')
  const companyLine = [card.company, card.companyEn].filter(Boolean).join('  ')
  const titleLine = [card.title, card.titleEn].filter(Boolean).join('  ')

  const lines = [
    '✅ 名片分析完成！',
    '',
    nameLine ? `👤 ${nameLine}` : '',
    titleLine ? `💼 ${titleLine}` : '',
    companyLine ? `🏢 ${companyLine}` : '',
    card.mobile ? `📱 ${card.mobile}` : '',
    card.officePhone ? `☎️ ${card.officePhone}` : '',
    card.fax ? `📠 ${card.fax}` : '',
    card.email ? `📧 ${card.email}` : '',
    card.website ? `🌐 ${card.website}` : '',
    card.address ? `📍 ${card.address}` : '',
    '',
    `${scoreBar} 人脈評分：${card.score}/10`,
    `📌 分類：${card.category}`,
    `💡 ${card.followUpSuggestion}`,
    '',
    `📅 跟進提醒：${followUpDate.toLocaleDateString('zh-TW')}（${card.followUpDays}天後）`,
  ]
  return lines.filter(Boolean).join('\n')
}
