import type OpenAI from 'openai'
import { openai, AGENT_MODEL } from './ai'
import { getHistory, appendExchange } from './conversation'
import {
  searchContacts, findContactByName, getPendingFollowUps,
  updateContactStatus, updateContactField, addContactNote,
  getContactStats, getLatestContact, updateContactSource,
  getContactsNeedingSource, setPendingBackfill, consumePendingBackfill,
  Contact, BackfillItem,
} from './contact-service'
import {
  createCalendarEvent, listEvents, isCalendarConnected, getAuthUrl,
  fetchEventsOnDate, pickBestEvent, taipeiDate,
} from './google-calendar'
import {
  addDeal, addPayment, getDeals, getPayments, voidLatestRecord,
  toDealLites, toPaymentLites, parseDateOrToday,
  DealProduct, DealDelivery, DEAL_PRODUCTS, DEAL_DELIVERIES,
} from './deal-service'
import { computeProgress, formatProgress, adsStatusLine, taipeiYm } from './business-progress'

// ── 工具回傳的聯絡人摘要 ─────────────────────────────────────
function contactBrief(c: Contact): string {
  return [
    `姓名：${c.nameZh || c.nameEn || '未知'}${c.nameEn && c.nameZh ? `（${c.nameEn}）` : ''}`,
    `公司：${c.company || '未知'}`,
    c.title ? `職稱：${c.title}` : '',
    c.mobile ? `手機：${c.mobile}` : '',
    c.officePhone ? `公司電話：${c.officePhone}` : '',
    c.email ? `Email：${c.email}` : '',
    `評分：${c.score}/10｜分類：${c.category}｜狀態：${c.status}`,
  ].filter(Boolean).join('\n')
}

function contactFull(c: Contact): string {
  return [
    contactBrief(c),
    c.website ? `網站：${c.website}` : '',
    c.address ? `地址：${c.address}` : '',
    c.industry ? `產業：${c.industry}｜規模：${c.companySize}` : '',
    c.services?.length ? `服務項目：${c.services.join('、')}` : '',
    c.source ? `認識場合：${c.source}` : '',
    c.followUpSuggestion ? `跟進建議：${c.followUpSuggestion}` : '',
    c.isDobBizPotential ? `DobBiz 機會：${c.dobBizNote}` : '',
    c.notes?.length ? `歷史筆記：\n${c.notes.map(n => `・${n}`).join('\n')}` : '（尚無筆記）',
  ].filter(Boolean).join('\n')
}

// ── 工具定義（送給模型看的 schema）───────────────────────────
const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_contacts',
      description: '在人脈庫搜尋聯絡人。支援姓名、公司、職稱、產業、分類的模糊搜尋，回傳最多 5 筆摘要。',
      strict: true,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜尋關鍵字（姓名或公司等）' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact_details',
      description: '取得單一聯絡人的完整資料，包含所有歷史筆記、跟進建議、DobBiz 標記。要起草跟進訊息或回答某個人的細節時先呼叫這個。',
      strict: true,
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '姓名或公司名（模糊匹配，取最相關一筆）' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_latest_contact',
      description: '取得最近一次掃描名片建立的聯絡人。使用者說「剛剛那張名片」「這個人」時用這個。',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pending_followups',
      description: '列出目前已到期、需要跟進的聯絡人（最多 5 筆）。',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_contact_status',
      description: '更新聯絡人的跟進狀態。使用者說「我聯絡過王大明了」「跟林董成交了」時用這個。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '姓名或公司名' },
          status: { type: 'string', enum: ['待跟進', '已聯絡', '已提案', '成交', '引薦完成'] },
        },
        required: ['name', 'status'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_contact_note',
      description: '幫聯絡人新增一則筆記（會議內容、聊到的需求、個人資訊等）。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '姓名或公司名' },
          note: { type: 'string', description: '筆記內容' },
        },
        required: ['name', 'note'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'correct_contact_field',
      description: '修正聯絡人的姓名或公司名稱（名片辨識錯誤時使用）。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '目前記錄的姓名或公司名（用來找到這筆資料）' },
          field: { type: 'string', enum: ['nameZh', 'nameEn', 'company', 'companyEn'] },
          value: { type: 'string', description: '正確的值' },
        },
        required: ['name', 'field', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_contact_source',
      description: '修改聯絡人的「認識場合」。使用者說「王大明是在五金展認識的」「場合記錯了，那張是在明志科大」時用這個。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '姓名或公司名' },
          source: { type: 'string', description: '正確的認識場合名稱' },
        },
        required: ['name', 'source'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_source_backfill',
      description: '掃描場合還是預設「其他」的舊聯絡人，用建檔時間反查當天日曆，推測他們是在哪個活動認識的。只產生提案不寫入，結果要先給使用者確認。使用者說「補場合」「把舊名片的場合補回去」時用這個。',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_source_backfill',
      description: '把上一步 preview_source_backfill 的提案正式寫入資料庫。只有在使用者明確表示確認、要、好、寫入之後才可以呼叫。',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact_stats',
      description: '取得人脈庫統計：總人數、本週新增、分類分佈、產業分佈、跟進狀態分佈、DobBiz 潛力數。',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_events',
      description: '查詢 Google 日曆某段時間的行程。使用者問「今天/明天/下週三有什麼行程」時用這個。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          start_iso: { type: 'string', description: '起始時間，ISO 8601 含 +08:00，例如 2026-07-27T00:00:00+08:00' },
          end_iso: { type: 'string', description: '結束時間，ISO 8601 含 +08:00' },
        },
        required: ['start_iso', 'end_iso'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_deal',
      description: '記錄一筆新簽的案子（簽約成交才記，談案中不記）。使用者說「簽了XX公司12萬網站案」「XX的SEO年約成交了」時用這個。金額一律換算成元（12萬=120000）。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: '客戶名稱（公司名或慣用簡稱）' },
          amount: { type: 'string', description: '簽約金額，純數字字串，單位元，例如 120000' },
          product: { type: 'string', enum: ['網頁', 'SEO年約', '主機維護', '廣告', '其他'] },
          delivery: { type: 'string', enum: ['內部', '外包', '未定'], description: '交付方式。使用者沒講就填未定' },
          note: { type: 'string', description: '備註，沒有就空字串' },
          signed_date: { type: 'string', description: '簽約日 YYYY-MM-DD，使用者沒講就空字串（=今天）' },
        },
        required: ['client', 'amount', 'product', 'delivery', 'note', 'signed_date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_payment',
      description: '記錄一筆實際收到的款項。使用者說「XX付了訂金4.8萬」「收到XX尾款」時用這個。金額一律換算成元。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: '付款的客戶名稱' },
          amount: { type: 'string', description: '收款金額，純數字字串，單位元' },
          note: { type: 'string', description: '款項性質（訂金/期中款/尾款/年約款等），沒有就空字串' },
          paid_date: { type: 'string', description: '收款日 YYYY-MM-DD，沒講就空字串（=今天）' },
        },
        required: ['client', 'amount', 'note', 'paid_date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_business_progress',
      description: '業務戰情報告：本月簽約與實收、三大觸發器進度（買車里程碑38萬×3月、請製作人力=外包溢出2案×3月、請SEO執行=年約7家）、廣告時間軸。使用者問「進度」「戰情」「差多遠」「這個月簽多少」時用這個。',
      strict: true,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_business_records',
      description: '列出某個月的簽案與收款明細，供核對。使用者說「這個月簽了哪些」「列一下八月的帳」時用這個。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: '月份 YYYY-MM，空字串=本月' },
        },
        required: ['month'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'void_business_record',
      description: '作廢一筆記錯的簽案或收款（取最近一筆符合該客戶名的紀錄）。使用者說「剛剛那筆記錯了」「刪掉XX那筆收款」時用這個。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['簽案', '收款'] },
          client: { type: 'string', description: '客戶名稱' },
        },
        required: ['kind', 'client'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description: '在 Google 日曆建立行程。從使用者的自然語言解析出標題與時間後呼叫。時間沒講明結束就預設 1 小時。',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '行程標題，簡短，例如「與林董會議」' },
          start_iso: { type: 'string', description: '開始時間，ISO 8601 含 +08:00' },
          end_iso: { type: 'string', description: '結束時間，ISO 8601 含 +08:00' },
          location: { type: 'string', description: '地點，沒有則空字串' },
        },
        required: ['title', 'start_iso', 'end_iso', 'location'],
        additionalProperties: false,
      },
    },
  },
]

// ── 工具實作（綁定 lineUserId，確保只能存取自己的資料）──────
type ToolArgs = Record<string, string>

function buildHandlers(lineUserId: string): Record<string, (a: ToolArgs) => Promise<string>> {
  return {
    async search_contacts({ query }) {
      const results = await searchContacts(lineUserId, query)
      if (results.length === 0) return `找不到「${query}」相關的聯絡人。`
      return results.map(c => contactBrief(c)).join('\n---\n')
    },

    async get_contact_details({ name }) {
      const c = await findContactByName(lineUserId, name)
      if (!c) return `找不到「${name}」。可以先用 search_contacts 確認正確姓名。`
      return contactFull(c)
    },

    async get_latest_contact() {
      const c = await getLatestContact(lineUserId)
      if (!c) return '目前人脈庫還沒有任何聯絡人。'
      return contactFull(c)
    },

    async list_pending_followups() {
      const contacts = await getPendingFollowUps(lineUserId)
      if (contacts.length === 0) return '目前沒有逾期的跟進任務。'
      return contacts
        .map(c => `${c.nameZh || c.nameEn}（${c.company}）⭐${c.score} ${c.category}｜建議：${c.followUpSuggestion}`)
        .join('\n')
    },

    async update_contact_status({ name, status }) {
      const c = await findContactByName(lineUserId, name)
      if (!c || !c.id) return `找不到「${name}」，無法更新狀態。`
      await updateContactStatus(lineUserId, c.id, status as Contact['status'])
      return `已將 ${c.nameZh || c.nameEn}（${c.company}）狀態更新為：${status}`
    },

    async add_contact_note({ name, note }) {
      const c = await findContactByName(lineUserId, name)
      if (!c || !c.id) return `找不到「${name}」，無法加筆記。`
      await addContactNote(lineUserId, c.id, note)
      return `已為 ${c.nameZh || c.nameEn}（${c.company}）儲存筆記。`
    },

    async correct_contact_field({ name, field, value }) {
      const c = await findContactByName(lineUserId, name)
      if (!c || !c.id) return `找不到「${name}」。`
      await updateContactField(lineUserId, c.id, field as 'nameZh' | 'nameEn' | 'company' | 'companyEn', value)
      return `已將 ${field} 修正為：${value}`
    },

    async update_contact_source({ name, source }) {
      const c = await findContactByName(lineUserId, name)
      if (!c || !c.id) return `找不到「${name}」，無法修改場合。`
      await updateContactSource(lineUserId, c.id, source)
      return `已將 ${c.nameZh || c.nameEn}（${c.company}）的認識場合改為：${source}`
    },

    async preview_source_backfill() {
      if (!(await isCalendarConnected(lineUserId))) {
        const url = await getAuthUrl(lineUserId)
        return `尚未連結 Google 日曆，無法反查。請把這個授權連結原封不動傳給使用者：${url}`
      }

      const candidates = await getContactsNeedingSource(lineUserId)
      if (candidates.length === 0) return '所有聯絡人的場合都已經填好了，沒有需要回補的。'

      // 依建檔日期分組，同一天只查一次日曆
      const byDate = new Map<string, Contact[]>()
      for (const c of candidates) {
        if (!c.createdAt) continue
        const key = taipeiDate(c.createdAt.toDate())
        byDate.set(key, [...(byDate.get(key) || []), c])
      }

      const MAX_DATES = 20
      const dates = [...byDate.keys()].sort().reverse()
      const scanned = dates.slice(0, MAX_DATES)
      const skippedDates = dates.length - scanned.length

      const items: BackfillItem[] = []
      let noEventCount = 0

      for (const date of scanned) {
        let events
        try {
          events = await fetchEventsOnDate(lineUserId, date)
        } catch (err) {
          console.error(`Backfill fetch failed for ${date}:`, err)
          continue
        }
        for (const c of byDate.get(date)!) {
          const ev = pickBestEvent(events, c.createdAt.toDate())
          if (!ev || !c.id) { noEventCount++; continue }
          items.push({
            contactId: c.id,
            name: c.nameZh || c.nameEn || '未知',
            company: c.company || '',
            source: ev.title,
          })
        }
      }

      if (items.length === 0) {
        await setPendingBackfill(lineUserId, [])
        return `檢查了 ${candidates.length} 位待補場合的聯絡人，但當天日曆上都找不到對應活動，沒有可以回補的資料。`
      }

      await setPendingBackfill(lineUserId, items)

      const preview = items.map(i => `・${i.name}${i.company ? `（${i.company}）` : ''} → ${i.source}`).join('\n')
      return [
        `找到 ${items.length} 筆可以回補的場合（尚未寫入，等使用者確認）：`,
        preview,
        '',
        `另有 ${noEventCount} 位當天日曆查無活動，維持原樣。`,
        skippedDates > 0 ? `注意：待補資料橫跨 ${dates.length} 個日期，本次只掃描最近 ${MAX_DATES} 天，還有 ${skippedDates} 天沒掃到，可以再執行一次。` : '',
        '',
        '請把這份清單原樣列給使用者，並問他要不要寫入。使用者確認後才呼叫 apply_source_backfill。',
      ].filter(Boolean).join('\n')
    },

    async apply_source_backfill() {
      const items = await consumePendingBackfill(lineUserId)
      if (!items) return '沒有待確認的回補提案，請先執行 preview_source_backfill。'

      let applied = 0
      for (const item of items) {
        const ok = await updateContactSource(lineUserId, item.contactId, item.source)
        if (!ok) continue
        await addContactNote(lineUserId, item.contactId, `場合回補：在「${item.source}」認識（依建檔當天日曆推測）`)
        applied++
      }
      return `已回補 ${applied} 筆聯絡人的認識場合。`
    },

    async get_contact_stats() {
      return JSON.stringify(await getContactStats(lineUserId))
    },

    async get_calendar_events({ start_iso, end_iso }) {
      if (!(await isCalendarConnected(lineUserId))) {
        const url = await getAuthUrl(lineUserId)
        return `尚未連結 Google 日曆。請把這個授權連結原封不動傳給使用者：${url}`
      }
      const events = await listEvents(lineUserId, new Date(start_iso), new Date(end_iso))
      if (events.length === 0) return '這段時間沒有任何行程。'
      return events.map(e => `${e.date} ${e.time} ${e.title}${e.location ? ` @ ${e.location}` : ''}`).join('\n')
    },

    async record_deal({ client, amount, product, delivery, note, signed_date }) {
      const amt = Number(amount.replace(/[,\s]/g, ''))
      if (!Number.isFinite(amt) || amt <= 0) return `金額「${amount}」無法解析，請確認後重試。`
      if (!(DEAL_PRODUCTS as readonly string[]).includes(product)) return `產品線「${product}」不在清單內。`
      const signedAt = parseDateOrToday(signed_date)
      if (!signedAt) return `日期「${signed_date}」格式錯誤，要用 YYYY-MM-DD。`
      await addDeal(lineUserId, client, amt, product as DealProduct, delivery as DealDelivery, note, signedAt)
      return `已記錄簽案：${client}｜${product}｜${amt.toLocaleString()} 元｜交付：${delivery}${note ? `｜${note}` : ''}`
    },

    async record_payment({ client, amount, note, paid_date }) {
      const amt = Number(amount.replace(/[,\s]/g, ''))
      if (!Number.isFinite(amt) || amt <= 0) return `金額「${amount}」無法解析，請確認後重試。`
      const paidAt = parseDateOrToday(paid_date)
      if (!paidAt) return `日期「${paid_date}」格式錯誤，要用 YYYY-MM-DD。`
      await addPayment(lineUserId, client, amt, note, paidAt)
      return `已記錄收款：${client}｜${amt.toLocaleString()} 元${note ? `｜${note}` : ''}`
    },

    async get_business_progress() {
      const [deals, payments] = await Promise.all([getDeals(lineUserId), getPayments(lineUserId)])
      const now = new Date()
      const progress = computeProgress(toDealLites(deals), toPaymentLites(payments), taipeiYm(now))
      return formatProgress(progress, adsStatusLine(now))
    },

    async list_business_records({ month }) {
      const ym = month || taipeiYm(new Date())
      const [deals, payments] = await Promise.all([getDeals(lineUserId), getPayments(lineUserId)])
      const monthDeals = deals.filter(d => taipeiYm(d.signedAt.toDate()) === ym)
      const monthPays = payments.filter(p => taipeiYm(p.paidAt.toDate()) === ym)
      if (monthDeals.length === 0 && monthPays.length === 0) return `${ym} 還沒有任何簽案或收款紀錄。`
      const dealLines = monthDeals
        .sort((a, b) => a.signedAt.seconds - b.signedAt.seconds)
        .map(d => `・${d.client}｜${d.product}｜${d.amount.toLocaleString()} 元｜${d.delivery}${d.note ? `｜${d.note}` : ''}`)
      const payLines = monthPays
        .sort((a, b) => a.paidAt.seconds - b.paidAt.seconds)
        .map(p => `・${p.client}｜${p.amount.toLocaleString()} 元${p.note ? `｜${p.note}` : ''}`)
      return [
        `${ym} 簽案 ${monthDeals.length} 筆：`,
        ...(dealLines.length ? dealLines : ['（無）']),
        '',
        `${ym} 收款 ${monthPays.length} 筆：`,
        ...(payLines.length ? payLines : ['（無）']),
      ].join('\n')
    },

    async void_business_record({ kind, client }) {
      const voided = await voidLatestRecord(lineUserId, kind as '簽案' | '收款', client)
      if (!voided) return `找不到「${client}」的${kind}紀錄，沒有東西被作廢。`
      return `已作廢最近一筆${kind}：${voided}`
    },

    async create_calendar_event({ title, start_iso, end_iso, location }) {
      if (!(await isCalendarConnected(lineUserId))) {
        const url = await getAuthUrl(lineUserId)
        return `尚未連結 Google 日曆。請把這個授權連結原封不動傳給使用者：${url}`
      }
      const link = await createCalendarEvent(
        lineUserId, title, new Date(start_iso), new Date(end_iso), location || undefined
      )
      return `行程已建立成功。日曆連結：${link}`
    },
  }
}

// ── 系統提示 ─────────────────────────────────────────────────
function systemPrompt(): string {
  const now = new Date()
  const dateStr = now.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit',
  })
  return `你是「隨身特助」，一位整合行銷顧問的私人 AI 助理，透過 LINE 對話服務唯一的主人。

現在時間：${dateStr}（Asia/Taipei，UTC+8）。解析「明天」「下週三」等相對時間時以此為準。

主人背景：
- 網站規劃顧問 + SEO 顧問，服務中小企業主、工廠老闆、B2B 製造商
- BNI 成員，重視引薦網絡與互補型夥伴
- 經營 DobBiz（B2B AI 採購媒合平台，連結製造商與採購商）

你的職責：
1. 人脈管理：搜尋聯絡人、更新跟進狀態、記筆記、修正名片辨識錯誤、修改認識場合、回報統計
2. 行程管理：查詢與建立 Google 日曆行程
3. 起草訊息：撰寫 LINE/Email 跟進訊息（先用 get_contact_details 拿完整背景與筆記再寫，草稿要自然、專業、有溫度、不官腔，LINE 訊息 100 字內）
4. 業務戰情：記錄簽案（record_deal）與收款（record_payment），回報三大觸發器進度（get_business_progress）

業務戰情規則：
- 「簽了/成交/拿下XX案」= record_deal；「收到款/付了訂金/入帳」= record_payment；「進度/戰情/差多遠」= get_business_progress
- 金額口語要換算成元：12萬=120000、4萬8=48000
- 使用者說「跟某聯絡人成交了」時，除了 record_deal 也要順手 update_contact_status 成「成交」
- 產品線分類：網站/官網/改版=網頁；SEO/AEO年約=SEO年約；主機/維護=主機維護；分不出來就問一句
- 三大觸發器的門檻寫在工具回覆裡，不要自己編數字

行為準則：
- 動手前先用工具查證，不要憑空猜測人脈庫內容
- 使用者的口語表達要主動理解意圖：「我剛跟王大明通過電話」= 更新狀態為已聯絡；「幫我約林董下週三三點」= 建立行程
- 一句話可能包含多個動作（例如「跟王大明聊完了，他想做官網，下週再約」= 更新狀態 + 記筆記），全部都要執行
- 找不到聯絡人時，告訴使用者最接近的搜尋結果，不要瞎猜
- 工具回傳「尚未連結 Google 日曆」時，把授權連結完整傳給使用者
- 掃名片時系統會自動從日曆判定認識場合，使用者說場合記錯了就用 update_contact_source 改
- 回補舊資料一定要兩步：先 preview_source_backfill 把清單給使用者看，等他明確說要，才 apply_source_backfill。絕不可以跳過確認直接寫入
- 無法確定使用者意圖時，簡短問清楚，不要長篇大論

回覆格式（LINE 純文字）：
- 繁體中文，口語自然，簡潔，不用 Markdown 符號（沒有 ** 或 #）
- 適度用表情符號開頭標記類型（✅ 完成、🔍 搜尋結果、📅 行程、✍️ 草稿、⚠️ 問題）
- 條列用「・」，每句話結束換行，不要擠成一團
- 回覆聚焦在使用者要的東西，不要重複多餘客套`
}

// ── 主入口：tool-calling 迴圈 ────────────────────────────────
const MAX_ITERATIONS = 8

export async function runAgent(lineUserId: string, userText: string): Promise<string> {
  const history = await getHistory(lineUserId)
  const handlers = buildHandlers(lineUserId)

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt() },
    ...history.map(t => ({ role: t.role, content: t.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
    { role: 'user', content: userText },
  ]

  let answer = ''

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: AGENT_MODEL,
      messages,
      tools: TOOL_DEFS,
    })

    const message = response.choices[0].message
    messages.push(message)

    const toolCalls = (message.tool_calls || []).filter(tc => tc.type === 'function')
    if (toolCalls.length === 0) {
      answer = message.content?.trim() || ''
      break
    }

    // 依序執行模型要求的工具，結果全部回填後再進下一輪
    for (const call of toolCalls) {
      const handler = handlers[call.function.name]
      let result: string
      if (!handler) {
        result = `錯誤：沒有這個工具（${call.function.name}）。`
      } else {
        try {
          result = await handler(JSON.parse(call.function.arguments || '{}'))
        } catch (err) {
          console.error(`Tool ${call.function.name} failed:`, err)
          result = `工具執行失敗：${err instanceof Error ? err.message : '未知錯誤'}。請告訴使用者這個動作沒有成功。`
        }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  if (!answer) answer = '⚠️ 這件事我處理太久了，可以說得更具體一點嗎？'

  await appendExchange(lineUserId, userText, answer)
  return answer
}
