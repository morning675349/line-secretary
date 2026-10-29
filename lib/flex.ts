// LINE Flex Message 卡片。
//
// 純文字回覆的問題是「看完之後還要自己動手」：想打電話要複製號碼、
// 想標記已聯絡要再打一句話。卡片把下一步變成一個按鈕。
// 這層只組資料結構不送出，方便單獨驗證。

export interface ContactCardData {
  contactId: string
  name: string
  company: string
  title: string
  score: number
  category: string
  status: string
  source: string
  lastNote: string
  mobile: string
  officePhone: string
}

// LINE 對各欄位有長度限制，超長會整則訊息被退回
const MAX_ALT = 380
const MAX_LINE = 60

function clip(text: string, max = MAX_LINE): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 台灣電話轉成可撥號的 tel: URI（去掉分隔符號） */
export function telUri(phone: string): string {
  return `tel:${(phone || '').replace(/[^\d+]/g, '')}`
}

function infoRow(label: string, value: string) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#AAAAAA', size: 'sm', flex: 2 },
      { type: 'text', text: clip(value), color: '#666666', size: 'sm', flex: 5, wrap: true },
    ],
  }
}

export function contactBubble(c: ContactCardData) {
  const phone = c.mobile || c.officePhone
  const rows = [
    c.title ? infoRow('職稱', c.title) : null,
    c.source && c.source !== '其他' ? infoRow('認識於', c.source) : null,
    phone ? infoRow('電話', phone) : null,
    c.lastNote ? infoRow('最後筆記', c.lastNote) : null,
  ].filter(Boolean)

  const buttons = [
    phone
      ? { type: 'button', style: 'primary', height: 'sm', color: '#1DB446',
          action: { type: 'uri', label: '📞 撥號', uri: telUri(phone) } }
      : null,
    { type: 'button', style: 'secondary', height: 'sm',
      action: { type: 'postback', label: '✍️ 起草跟進訊息', data: `draft:${c.contactId}`, displayText: `幫我寫跟進訊息給 ${c.name}` } },
    c.status !== '已聯絡'
      ? { type: 'button', style: 'link', height: 'sm',
          action: { type: 'postback', label: '✅ 標記已聯絡', data: `contacted:${c.contactId}`, displayText: `${c.name} 已聯絡` } }
      : null,
  ].filter(Boolean)

  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: clip(c.name, 20), weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: clip(c.company || '（未填公司）', 30), size: 'sm', color: '#888888', wrap: true },
        {
          type: 'box', layout: 'baseline', margin: 'md', spacing: 'sm',
          contents: [
            { type: 'text', text: `⭐ ${c.score}/10`, size: 'sm', color: '#F5A623', flex: 0 },
            { type: 'text', text: `${c.category}｜${c.status}`, size: 'sm', color: '#666666', flex: 0, margin: 'md' },
          ],
        },
        ...(rows.length ? [{ type: 'separator', margin: 'md' }] : []),
        ...(rows.length ? [{ type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: rows }] : []),
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
  }
}

/** 一到多位聯絡人的卡片訊息；LINE 輪播上限 12 張 */
export function contactCarousel(contacts: ContactCardData[]) {
  const picked = contacts.slice(0, 12)
  const names = picked.map(c => c.name).join('、')
  const altText = clip(`聯絡人：${names}`, MAX_ALT)

  return picked.length === 1
    ? { type: 'flex', altText, contents: contactBubble(picked[0]) }
    : { type: 'flex', altText, contents: { type: 'carousel', contents: picked.map(contactBubble) } }
}

// ── 掃名片結果卡片 ──────────────────────────────────────────
//
// 以前掃一張名片會送出四則訊息（分析中、結果、問場合、問服務項目），
// 其中兩則還在等你回答。展場上這等於每張名片要處理四次通知。
// 這張卡片把全部收進一則，而且不需要你回答任何問題。
//
// 放名片縮圖是關鍵：辨識錯誤真正的代價不是「會錯」，
// 是「你當下不知道它錯了」，等三週後要聯絡才發現名字是錯的。
// 原圖擺在解析結果旁邊，錯誤當場就看得出來。

export interface ScanCardData {
  contactId: string
  imageUrl: string
  name: string
  company: string
  title: string
  mobile: string
  email: string
  source: string
  score: number
  category: string
  followUpDate: string
  uncertainLabels: string[]
  expoIndex: number
}

// OCR 回報的欄位英文名轉成卡片上看得懂的中文
const FIELD_LABELS: Record<string, string> = {
  nameZh: '中文姓名', nameEn: '英文姓名',
  company: '公司名稱', companyEn: '英文公司名',
  title: '職稱', titleEn: '英文職稱',
  mobile: '手機', officePhone: '公司電話', fax: '傳真',
  email: 'Email', address: '地址', website: '網站', services: '服務項目',
}

export function uncertainLabelsOf(fields: string[]): string[] {
  return (fields || []).map(f => FIELD_LABELS[f] || f).filter(Boolean)
}

export function scanResultBubble(c: ScanCardData) {
  const phone = c.mobile || ''
  const rows = [
    c.title ? infoRow('職稱', c.title) : null,
    phone ? infoRow('電話', phone) : null,
    c.email ? infoRow('Email', c.email) : null,
    // 場合沒判定出來時一定要顯示，不能留白。
    // 實測資料顯示 110 筆聯絡人有 62 筆場合停在預設的「其他」，
    // 原因就是沒人告訴使用者「這張沒抓到場合」，展後要撈名單時才發現撈不到。
    c.source && c.source !== '其他'
      ? infoRow('場合', c.source)
      : { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
          { type: 'text', text: '場合', color: '#AAAAAA', size: 'sm', flex: 2 },
          { type: 'text', text: '⚠️ 未判定，請按下方補', color: '#B26A00', size: 'sm', flex: 5, wrap: true },
        ] },
    c.expoIndex === 0 && c.followUpDate ? infoRow('跟進', c.followUpDate) : null,
  ].filter(Boolean)

  const header = c.expoIndex > 0
    ? { type: 'text', text: `📇 第 ${c.expoIndex} 張`, size: 'xs', color: '#AAAAAA' }
    : { type: 'text', text: '✅ 名片已建檔', size: 'xs', color: '#1DB446' }

  // 不確定欄位做成明顯的警示區塊，不是藏在小字裡
  const warning = c.uncertainLabels.length > 0
    ? [{
        type: 'box', layout: 'vertical', margin: 'md', paddingAll: 'sm',
        backgroundColor: '#FFF4E5', cornerRadius: 'md',
        contents: [
          { type: 'text', text: `⚠️ 這幾欄沒把握：${c.uncertainLabels.join('、')}`,
            size: 'xs', color: '#B26A00', wrap: true },
          { type: 'text', text: '請對照上方名片原圖確認', size: 'xxs', color: '#B26A00', margin: 'xs' },
        ],
      }]
    : []

  const scoreRow = c.expoIndex === 0
    ? [{
        type: 'box', layout: 'baseline', margin: 'md', spacing: 'sm',
        contents: [
          { type: 'text', text: `⭐ ${c.score}/10`, size: 'sm', color: '#F5A623', flex: 0 },
          { type: 'text', text: c.category, size: 'sm', color: '#666666', flex: 0, margin: 'md' },
        ],
      }]
    : []

  // ⚠️ Flex 按鈕的 action 不可以帶 inputOption／fillInText。
  //
  // 2026-10-29 事故：這張卡片上線後第一次被使用（10/29 11:17）就被 LINE 退件，
  // 使用者只看到「發生錯誤」。LINE 的驗證端點回的是
  //   invalid property: /footer/contents/1/action/inputOption
  // inputOption 與 fillInText 只在「快速回覆」與「圖文選單」的 action 裡合法
  // （lib/line-client.ts 的 quickReply 與 lib/richmenu.ts 用得好好的，就是這個原因），
  // Flex 的按鈕不吃。改這裡之前先跑 /api/admin/validate-flex。
  const buttons = [
    phone
      ? { type: 'button', style: 'primary', height: 'sm', color: '#1DB446',
          action: { type: 'uri', label: '📞 撥號', uri: telUri(phone) } }
      : null,
    { type: 'button', style: 'secondary', height: 'sm',
      action: { type: 'postback', label: '✏️ 修正名字', data: `correct_name:${c.contactId}` } },
    { type: 'button', style: 'link', height: 'sm',
      action: { type: 'postback', label: '🏢 修正公司', data: `correct_company:${c.contactId}` } },
    { type: 'button', style: 'link', height: 'sm',
      action: { type: 'postback', label: '📍 改場合', data: `src_other:${c.contactId}` } },
  ].filter(Boolean)

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [
        header,
        { type: 'text', text: clip(c.name || '（辨識不出姓名）', 20), weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: clip(c.company || '（未填公司）', 30), size: 'sm', color: '#888888', wrap: true },
        ...scoreRow,
        ...warning,
        ...(rows.length ? [{ type: 'separator', margin: 'md' }] : []),
        ...(rows.length ? [{ type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: rows }] : []),
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
  }

  // 縮圖上傳失敗時就不放 hero，卡片其他部分照常顯示。
  //
  // aspectMode 用 fit 不用 cover：cover 會裁掉邊緣，而被裁掉的地方
  // 可能正好是要核對的電話或 Email，那就失去放原圖的意義了。
  // 另外掛上點擊開啟原圖，字太小時可以放大看。
  if (c.imageUrl) {
    bubble.hero = {
      type: 'image',
      url: c.imageUrl,
      size: 'full',
      aspectRatio: '16:10',
      aspectMode: 'fit',
      backgroundColor: '#F4F4F4',
      action: { type: 'uri', label: '看原圖', uri: c.imageUrl },
    }
  }

  return bubble
}

export function scanResultMessage(c: ScanCardData) {
  const prefix = c.expoIndex > 0 ? `第 ${c.expoIndex} 張｜` : '名片已建檔｜'
  return {
    type: 'flex',
    altText: clip(`${prefix}${c.name}${c.company ? `（${c.company}）` : ''}`, MAX_ALT),
    contents: scanResultBubble(c),
  }
}
