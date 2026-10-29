import assert from 'node:assert'
import { test } from 'node:test'
import { scanResultBubble, scanResultMessage, uncertainLabelsOf } from './flex.ts'
import type { ScanCardData } from './flex.ts'

const mk = (over: Partial<ScanCardData> = {}): ScanCardData => ({
  contactId: 'c1', imageUrl: 'https://example.com/a.jpg',
  name: '林志明', company: '大展精密', title: '總經理',
  mobile: '0912345678', email: 'a@b.com', source: '五金展',
  score: 8, category: '潛在客戶', followUpDate: '10/23',
  uncertainLabels: [], expoIndex: 0, ...over,
})

test('欄位英文名轉成看得懂的中文', () => {
  assert.deepEqual(uncertainLabelsOf(['nameZh', 'mobile']), ['中文姓名', '手機'])
  assert.deepEqual(uncertainLabelsOf(['unknownField']), ['unknownField'])
  assert.deepEqual(uncertainLabelsOf([]), [])
})

test('有縮圖時放 hero，沒有時整張卡片仍可用', () => {
  assert.ok((scanResultBubble(mk()) as any).hero)
  assert.equal((scanResultBubble(mk({ imageUrl: '' })) as any).hero, undefined)
})

test('不確定欄位會出現警示區塊', () => {
  const json = JSON.stringify(scanResultBubble(mk({ uncertainLabels: ['中文姓名'] })))
  assert.match(json, /沒把握：中文姓名/)
  assert.match(json, /對照上方名片原圖/)
})

test('全部確定時不顯示警示', () => {
  assert.doesNotMatch(JSON.stringify(scanResultBubble(mk())), /沒把握/)
})

test('展場模式隱藏評分與跟進日，改顯示第幾張', () => {
  const json = JSON.stringify(scanResultBubble(mk({ expoIndex: 7 })))
  assert.match(json, /第 7 張/)
  assert.doesNotMatch(json, /⭐/)
  assert.doesNotMatch(json, /10\/23/)
})

test('沒有電話時不出現撥號鈕，修正鈕仍在', () => {
  const json = JSON.stringify(scanResultBubble(mk({ mobile: '' })))
  assert.doesNotMatch(json, /撥號/)
  assert.match(json, /修正名字/)
})

test('辨識不出姓名時給明確提示而不是空白', () => {
  assert.match(JSON.stringify(scanResultBubble(mk({ name: '' }))), /辨識不出姓名/)
})

test('altText 含姓名與公司，方便通知列辨識', () => {
  assert.match(scanResultMessage(mk()).altText, /林志明（大展精密）/)
})

test('縮圖完整顯示不裁切，且可點擊看原圖', () => {
  const hero = (scanResultBubble(mk()) as any).hero
  assert.equal(hero.aspectMode, 'fit', '不可用 cover，會裁掉要核對的欄位')
  assert.equal(hero.action.uri, 'https://example.com/a.jpg')
})

// 2026-10-29 事故的回歸測試。
//
// 這張卡片原本在按鈕上寫 inputOption: 'closeKeyboard'，而 LINE 沒有這個值。
// 整則訊息被退 400，使用者只看到「發生錯誤」，名片其實已經建檔成功了。
// 卡片 10/18 上線，11 天後第一次真的拿它掃名片才爆。
//
// 當時的測試只驗 JSON 形狀，驗不到 LINE 的規格。這條測試擋的是同一類錯誤：
// 不是禁用 inputOption（探針證實 Flex 按鈕吃這個屬性），而是值必須在清單內。
const VALID_INPUT_OPTIONS = ['closeRichMenu', 'openRichMenu', 'openKeyboard', 'openVoice']

test('按鈕的 inputOption 必須是 LINE 列的合法值，寫錯整則訊息被退 400', () => {
  const found = JSON.stringify(scanResultBubble(mk())).match(/"inputOption":"([^"]*)"/g) || []
  assert.ok(found.length > 0, '卡片應該有帶 inputOption 的按鈕，沒有的話這條測試就失去意義')
  for (const m of found) {
    const value = m.replace(/^"inputOption":"/, '').replace(/"$/, '')
    assert.ok(VALID_INPUT_OPTIONS.includes(value), `inputOption 不合法：${value}`)
  }
})
