import OpenAI from 'openai'
import sharp from 'sharp'

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
  services: string[]
  industry: '製造業' | '貿易商' | '服務業' | '科技' | '設計創意' | '金融法律' | '建築營造' | '餐飲零售' | '其他'
  companySize: '微型' | '小型' | '中型' | '大型' | '不明'
  score: number
  category: '潛在客戶' | 'BNI夥伴' | 'DobBiz用戶' | '引薦來源' | '待觀察'
  isDobBizPotential: boolean
  dobBizNote: string
  followUpDays: number
  followUpSuggestion: string
  reasoning: string
}

const SYSTEM_PROMPT = `你是一個商業名片 OCR 與分析助手。

⚠️ 人名辨識最重要，請特別注意：
- 仔細觀察筆畫細節，不要因字形相似就猜測（例如：傑/焰/燁/煜/燦、銘/鉞/銓/鎧、振/展/傳）
- 如果名字不確定，寧可標記「(待確認)」也不要猜錯
- 參考英文名或拼音（如果有）來交叉驗證中文名
- 公司名稱同樣要逐字確認，不要合理推測

關於這位顧問的背景：
- 主要服務：網站規劃（客製化）+ SEO顧問
- 目標客戶：中小企業主、工廠老闆、B2B製造商
- BNI成員：深度參與引薦網絡，需互補型夥伴
- 副業平台：DobBiz（B2B AI採購媒合平台，連結製造商與採購商）

評分標準（1-10）：
- 8-10：中小企業/工廠老闆、製造業採購業務（直接客戶或DobBiz用戶）
- 6-7：互補型服務提供者（攝影/印刷/PR/設計/律師/會計）= BNI夥伴
- 4-5：大企業中層主管
- 1-3：與業務無交集

分類規則（主分類，只選一個）：
- 潛在客戶：企業主可能需要網站或SEO
- BNI夥伴：互補型服務，可互相引薦
- DobBiz用戶：純製造商或純採購商角色
- 引薦來源：BNI成員或廣泛人脈型人士
- 待觀察：其他

DobBiz 雙重標記規則（isDobBizPotential）：
- 若公司屬於製造業、工廠、貿易商、供應商、代工廠，isDobBizPotential = true
- dobBizNote 填寫：為什麼這個人適合 DobBiz，以及建議的切入角度（一句話）

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
- services：名片上列出的服務項目或產品（陣列，沒有則空陣列）
- score：評分 1-10
- category：主分類
- industry：產業分類，從以下選一個：製造業、貿易商、服務業、科技、設計創意、金融法律、建築營造、餐飲零售、其他
- companySize：公司規模推估（微型<10人、小型10-50人、中型50-200人、大型200人以上、不明）
- isDobBizPotential：是否為 DobBiz 潛力用戶（布林值）
- dobBizNote：DobBiz 切入建議（isDobBizPotential 為 false 時填空字串）
- followUpDays：跟進天數
- followUpSuggestion：具體跟進建議（一句話）
- reasoning：評分理由（一句話）

未識別的欄位填空字串或空陣列。`

// Pass 1：純 OCR，只提取文字，不做任何推斷
async function extractRawText(imageBuffer: Buffer): Promise<string> {
  // 預處理：銳化 + 正規化對比，幫助模型看清楚細節
  const processed = await sharp(imageBuffer)
    .sharpen({ sigma: 1.2 })
    .normalise()
    .jpeg({ quality: 95 })
    .toBuffer()

  const base64 = processed.toString('base64')

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'high' },
          },
          {
            type: 'text',
            text: `請精確辨識這張名片上的所有文字，逐行列出，保持原始格式。

重要規則：
1. 看不清楚的字用【?】標記，絕對不要猜測
2. 中文字要逐筆確認，筆畫相似的字（傑/焰/燁/煜、銘/鉞/銓/鎧、振/展/傳/博）寧可標【?】也不要猜
3. 如果名片有英文拼音，用來交叉驗證中文名
4. 電話號碼完整列出，不要省略
5. 只輸出名片上看到的內容，不要增加任何推測`,
          },
        ],
      },
    ],
    max_tokens: 600,
  })

  return response.choices[0].message.content || ''
}

// Pass 2：純文字分析，把 OCR 結果解析成結構化 JSON
export async function analyzeCard(imageBuffer: Buffer): Promise<CardData> {
  const rawText = await extractRawText(imageBuffer)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `以下是從名片辨識出的原始文字（【?】代表不確定的字）：

${rawText}

請根據以上文字解析成完整 JSON。若欄位中有【?】，在該欄位後加上 (待確認) 提示。`,
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
    card.services?.length ? `\n🔧 服務項目：${card.services.join('、')}` : '',
    '',
    `${scoreBar} 人脈評分：${card.score}/10`,
    `📌 分類：${card.category}`,
    `💡 ${card.followUpSuggestion}`,
    card.isDobBizPotential ? `\n🔗 DobBiz 機會：${card.dobBizNote}` : '',
    '',
    `📅 跟進提醒：${followUpDate.toLocaleDateString('zh-TW')}（${card.followUpDays}天後）`,
  ]
  return lines.filter(Boolean).join('\n')
}
