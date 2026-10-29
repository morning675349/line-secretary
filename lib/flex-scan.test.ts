import assert from 'node:assert'
import { test } from 'node:test'
import { scanResultBubble, scanResultMessage, uncertainLabelsOf, duplicateBubble, duplicateCarousel } from './flex.ts'
import type { ScanCardData, DuplicateCardData } from './flex.ts'

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

// ── 合併狀態的呈現（2026-10-29 加入去重機制） ──────────────

test('併入既有名片時標頭要講出來，不然使用者以為剛掃的那張不見了', () => {
  const json = JSON.stringify(scanResultBubble(mk({ mergedChanges: ['補上 email', '併入 1 則筆記'] })))
  assert.match(json, /已併入既有名片/)
  assert.doesNotMatch(json, /名片已建檔/, '合併時不可以同時說「已建檔」，兩句話會互相矛盾')
  assert.match(json, /補上 email/, '要列出改了什麼，否則使用者無法判斷有沒有弄錯')
})

test('沒有合併時維持原本的已建檔訊息', () => {
  const json = JSON.stringify(scanResultBubble(mk()))
  assert.match(json, /名片已建檔/)
  assert.doesNotMatch(json, /已併入/)
})

test('手機撞號但姓名不同時給合併按鈕，並寫出是跟誰撞號', () => {
  const json = JSON.stringify(scanResultBubble(mk({
    suggestMerge: { contactId: 'oldid1', name: '李小華', company: '測試公司' },
  })))
  assert.match(json, /李小華/, '要寫出跟誰撞號，不然使用者無從判斷')
  assert.match(json, /是同一人，合併/)
  // primary 必須是既有那筆，順序顛倒會把舊的場合與筆記併進新的那筆
  assert.match(json, /"merge:oldid1:c1"/)
})

test('沒有撞號時不出現合併按鈕', () => {
  assert.doesNotMatch(JSON.stringify(scanResultBubble(mk())), /merge:/)
})

// ── 重複名片卡片（2026-10-29） ───────────────────────────────

const mkDup = (over: Partial<DuplicateCardData> = {}): DuplicateCardData => ({
  verdict: 'auto',
  primaryId: 'old1', secondaryId: 'new1',
  primaryName: '王小明', secondaryName: '王小明',
  primaryWhen: '7/28', secondaryWhen: '10/29',
  company: '測試股份有限公司', phone: '0912-345678',
  primarySource: '測試場合', primaryNoteCount: 2,
  ...over,
})

test('確定同一人與要判斷的兩種卡片要長得不一樣，不然使用者會亂按', () => {
  assert.match(JSON.stringify(duplicateBubble(mkDup())), /姓名與電話都相同/)
  assert.match(JSON.stringify(duplicateBubble(mkDup({ verdict: 'suggest' }))), /手機相同但姓名不同/)
})

test('卡片要先講合併會保留什麼，不然使用者不敢按', () => {
  const json = JSON.stringify(duplicateBubble(mkDup()))
  assert.match(json, /保留上面那筆/)
  assert.match(json, /測試場合/, '要寫出主檔的場合')
  assert.match(json, /2 則筆記/, '要寫出筆記會留著')
  assert.match(json, /還原/, '要讓使用者知道按錯可以救')
})

test('兩顆按鈕的 postback 格式要跟 webhook 對得上，順序也不能顛倒', () => {
  const json = JSON.stringify(duplicateBubble(mkDup()))
  // primary 是保留的那筆，secondary 是被併掉的，顛倒會把舊的場合與筆記併進新的那筆
  assert.match(json, /"merge:old1:new1"/)
  assert.match(json, /"notdup:old1:new1"/)
})

test('超過 12 組只送前 12 張，剩下的留到下一次檢查', () => {
  const many = Array.from({ length: 15 }, (_, i) => mkDup({ primaryId: `p${i}`, secondaryId: `s${i}` }))
  const msg = duplicateCarousel(many) as any
  assert.equal(msg.contents.type, 'carousel')
  assert.equal(msg.contents.contents.length, 12)
})

test('只有一組時送單張不送 carousel', () => {
  const msg = duplicateCarousel([mkDup()]) as any
  assert.equal(msg.contents.type, 'bubble')
})
