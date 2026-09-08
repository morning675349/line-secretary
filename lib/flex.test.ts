import assert from 'node:assert'
import { test } from 'node:test'
import { contactBubble, contactCarousel, telUri } from './flex.ts'

const base = {
  contactId: 'abc123', name: '林志明', company: '大展精密工業', title: '總經理',
  score: 8, category: '潛在客戶', status: '待跟進', source: 'BNI 台中南區例會',
  lastNote: '想做官網，預算約三十萬', mobile: '0912-345-678', officePhone: '04-2222-3333',
}

const labels = (bubble: any) => bubble.footer.contents.map((b: any) => b.action.label)

test('電話轉成可撥號的 tel URI', () => {
  assert.equal(telUri('0912-345-678'), 'tel:0912345678')
  assert.equal(telUri('(04) 2222-3333'), 'tel:0422223333')
})

test('有電話時附撥號按鈕', () => {
  assert.ok(labels(contactBubble(base)).includes('📞 撥號'))
})

test('沒有任何電話時不放撥號按鈕（避免按下去是空號）', () => {
  const b = contactBubble({ ...base, mobile: '', officePhone: '' })
  assert.ok(!labels(b).includes('📞 撥號'))
  assert.ok(labels(b).includes('✍️ 起草跟進訊息'))
})

test('已經聯絡過的人不再顯示標記已聯絡', () => {
  assert.ok(!labels(contactBubble({ ...base, status: '已聯絡' })).includes('✅ 標記已聯絡'))
})

test('按鈕帶的 postback data 含聯絡人 id', () => {
  const data = contactBubble(base).footer.contents.map((b: any) => b.action.data).filter(Boolean)
  assert.ok(data.includes('draft:abc123'))
  assert.ok(data.includes('contacted:abc123'))
})

test('場合是預設值「其他」時不顯示認識於', () => {
  const b = contactBubble({ ...base, source: '其他' })
  assert.ok(!JSON.stringify(b).includes('認識於'))
})

test('單筆用 bubble，多筆用 carousel', () => {
  assert.equal(contactCarousel([base]).contents.type, 'bubble')
  assert.equal(contactCarousel([base, { ...base, name: '王大明' }]).contents.type, 'carousel')
})

test('超過 12 筆只取前 12 筆（LINE 輪播上限）', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ ...base, name: `人${i}`, contactId: `id${i}` }))
  assert.equal((contactCarousel(many).contents as any).contents.length, 12)
})

test('過長的筆記會截斷，避免整則訊息被 LINE 退回', () => {
  const long = 'x'.repeat(500)
  const json = JSON.stringify(contactBubble({ ...base, lastNote: long }))
  assert.ok(!json.includes('x'.repeat(200)))
})
