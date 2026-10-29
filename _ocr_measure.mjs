// 名片 OCR 一致性量測（唯讀，絕不寫回 Firestore）
//
// 做法：抽樣既有名片，用正式環境的 prompt 重跑一次辨識，
// 跟資料庫現有值比對。不一致代表至少有一次是錯的，
// 所以這是錯誤率的「下限」，不是絕對準確率。
//
// 同時收集三件事：
//   1. 不一致率（姓名／公司／手機各自統計）
//   2. 圖片尺寸與位元組數（驗證「解析度不足」這個假設）
//   3. 模型自評的 uncertainFields 能不能預測真正的不一致

import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SAMPLE_SIZE = Number(process.argv[2] || 25)
const OUT_DIR = process.argv[3] || '/tmp/ocr-measure'

const env = fs.readFileSync('.env.local', 'utf8')
const get = k => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''
}

initializeApp({
  credential: cert({
    projectId: get('FIREBASE_PROJECT_ID'),
    clientEmail: get('FIREBASE_CLIENT_EMAIL'),
    privateKey: get('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }),
})
const db = getFirestore()
const openai = new OpenAI({ apiKey: get('OPENAI_API_KEY') })

const SYSTEM_PROMPT = fs.readFileSync('_ocr_prompt.txt', 'utf8')

// 聚焦在「讀得對不對」的欄位，不跑 CRM 評分，省 token 也讓比對單純
const SCHEMA = {
  type: 'object',
  properties: {
    nameZh: { type: 'string' },
    nameEn: { type: 'string' },
    company: { type: 'string' },
    mobile: { type: 'string' },
    officePhone: { type: 'string' },
    email: { type: 'string' },
    uncertainFields: { type: 'array', items: { type: 'string' } },
  },
  required: ['nameZh', 'nameEn', 'company', 'mobile', 'officePhone', 'email', 'uncertainFields'],
  additionalProperties: false,
}

/** 從 JPEG 位元組流讀出寬高，不必額外裝影像套件 */
function jpegSize(buf) {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    // SOF0..SOF15，排除 DHT(c4) DAC(cc) RST(d0-d7)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return { width: 0, height: 0 }
}

/** 電話只比數字，忽略括號與分隔符號的寫法差異 */
const digits = s => (s || '').replace(/\D/g, '')
const norm = s => (s || '').trim().replace(/\s+/g, '')

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const snap = await db.collection('contacts').get()
  const withImage = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.cardImageUrl)

  console.log(`名片總數 ${snap.size}，有原圖 ${withImage.length} 張`)

  // 平均抽樣，避免只取到某一批同場合的名片
  const step = Math.max(1, Math.floor(withImage.length / SAMPLE_SIZE))
  const sample = withImage.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE)
  console.log(`抽樣 ${sample.length} 張開始重跑辨識\n`)

  const rows = []
  for (const [i, c] of sample.entries()) {
    const stored = {
      nameZh: c.nameZh || '', company: c.company || '',
      mobile: c.mobile || '', email: c.email || '',
    }
    try {
      const res = await fetch(c.cardImageUrl)
      if (!res.ok) throw new Error(`圖片下載失敗 ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const { width, height } = jpegSize(buf)

      const r = await openai.chat.completions.create({
        model: 'gpt-5.5',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}`, detail: 'high' } },
              { type: 'text', text: '請仔細辨識名片上所有資訊，回傳完整 JSON。' },
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'card_recheck', strict: true, schema: SCHEMA } },
      })
      const fresh = JSON.parse(r.choices[0].message.content)

      const row = {
        id: c.id,
        width, height, bytes: buf.length,
        source: c.source || '',
        storedName: stored.nameZh, freshName: fresh.nameZh,
        storedCompany: stored.company, freshCompany: fresh.company,
        storedMobile: stored.mobile, freshMobile: fresh.mobile,
        nameMatch: norm(stored.nameZh) === norm(fresh.nameZh),
        companyMatch: norm(stored.company) === norm(fresh.company),
        mobileMatch: digits(stored.mobile) === digits(fresh.mobile),
        uncertain: fresh.uncertainFields || [],
      }
      rows.push(row)
      const flag = row.nameMatch ? '✓' : '✗'
      console.log(`${String(i + 1).padStart(2)}/${sample.length} ${flag} ${width}x${height} 「${stored.nameZh}」→「${fresh.nameZh}」${row.uncertain.length ? ` ⚠️${row.uncertain.join(',')}` : ''}`)
    } catch (err) {
      console.log(`${String(i + 1).padStart(2)}/${sample.length} ERR ${String(err.message).slice(0, 80)}`)
      rows.push({ id: c.id, error: String(err.message).slice(0, 120) })
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(rows, null, 2))
  console.log(`\n結果已寫入 ${path.join(OUT_DIR, 'results.json')}`)
  process.exit(0)
}

main()
