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
