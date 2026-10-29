import { test } from 'node:test'
import assert from 'node:assert'
import {
  phoneKey, nameKey, isMobileKey, classify,
  findMergeTargets, findDuplicateGroups, planMerge, describeGroup,
} from './contact-merge.ts'
import type { MergeCandidate } from './contact-merge.ts'

// 全部用假資料，不帶任何真實聯絡人內容
const mk = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  id: 'c1',
  nameZh: '王小明',
  company: '測試股份有限公司',
  mobile: '0912-345678',
  officePhone: '04-22223333',
  source: '其他',
  notes: [],
  status: '待跟進',
  createdAt: { seconds: 1_000_000 },
  ...over,
})

// ── 正規化 ────────────────────────────────────────────────

test('電話只留數字，+886 開頭換回 0', () => {
  assert.equal(phoneKey('0912-345678'), '0912345678')
  assert.equal(phoneKey('+886 912 345 678'), '0912345678')
  assert.equal(phoneKey('+886-4-2222-3333'), '0422223333')
  assert.equal(phoneKey('04-7709000 分機101'), '047709000101', '分機會被併進來，這是已知限制')
  assert.equal(phoneKey(''), '')
  assert.equal(phoneKey(undefined), '')
})

test('姓名去掉排版空白，中文名的空白不是內容', () => {
  assert.equal(nameKey(mk({ nameZh: '王 小 明' })), '王小明')
  assert.equal(nameKey(mk({ nameZh: '', nameEn: 'John Smith' })), 'johnsmith')
  assert.equal(nameKey(mk({ nameZh: '', nameEn: '' })), '')
})

test('手機判定要嚴格，壞資料不可以被當手機', () => {
  assert.ok(isMobileKey('0912345678'))
  assert.ok(!isMobileKey('09123456789'), 'OCR 多讀一位的 11 碼不算')
  assert.ok(!isMobileKey('0422223333'), '市話不算')
  assert.ok(!isMobileKey('0912345678' + '0958853688'), '一格塞兩支號碼不算')
  assert.ok(!isMobileKey(''))
})

// ── 關係判定 ──────────────────────────────────────────────

test('姓名相同加手機相同就自動合併', () => {
  assert.equal(classify(mk({ id: 'a' }), mk({ id: 'b' })), 'auto')
})

test('姓名相同加公司電話相同也自動合併', () => {
  const a = mk({ id: 'a', mobile: '' })
  const b = mk({ id: 'b', mobile: '' })
  assert.equal(classify(a, b), 'auto')
})

test('同一支號碼一邊放手機欄一邊放公司電話欄也算相同', () => {
  const a = mk({ id: 'a', mobile: '0912-345678', officePhone: '' })
  const b = mk({ id: 'b', mobile: '', officePhone: '0912345678' })
  assert.equal(classify(a, b), 'auto')
})

test('姓名不同但手機相同只給建議，不自動合併', () => {
  const a = mk({ id: 'a', nameZh: '王小明' })
  const b = mk({ id: 'b', nameZh: '王小華' })
  assert.equal(classify(a, b), 'suggest')
})

// 這是整個模組最重要的一條。
// 同公司不同人共用總機很正常，實測 113 筆裡就有 2 組。
// 把公司電話列入建議會產生永久性的誤判提示，使用者學會忽略之後，
// 真正的重複也會被一起忽略掉。
test('姓名不同且只有公司電話相同時什麼都不做，避免永久誤判噪音', () => {
  const a = mk({ id: 'a', nameZh: '王小明', mobile: '0912-345678', officePhone: '04-22223333' })
  const b = mk({ id: 'b', nameZh: '李小華', mobile: '0987-654321', officePhone: '04-22223333' })
  assert.equal(classify(a, b), 'none')
})

test('姓名不同且手機是壞資料時不給建議', () => {
  const bad = '09123456789' // 11 碼
  const a = mk({ id: 'a', nameZh: '王小明', mobile: bad, officePhone: '' })
  const b = mk({ id: 'b', nameZh: '李小華', mobile: bad, officePhone: '' })
  assert.equal(classify(a, b), 'none')
})

test('姓名相同但電話全不同不算重複，可能是同名的兩個人', () => {
  const a = mk({ id: 'a', mobile: '0912-345678', officePhone: '04-11112222' })
  const b = mk({ id: 'b', mobile: '0987-654321', officePhone: '04-33334444' })
  assert.equal(classify(a, b), 'none')
})

test('沒有姓名的名片不參與比對，否則會全部互相命中', () => {
  const a = mk({ id: 'a', nameZh: '', nameEn: '' })
  const b = mk({ id: 'b', nameZh: '', nameEn: '' })
  assert.equal(classify(a, b), 'none')
})

test('同一筆與已被合併的筆一律不再比對', () => {
  assert.equal(classify(mk({ id: 'same' }), mk({ id: 'same' })), 'none')
  assert.equal(classify(mk({ id: 'a' }), mk({ id: 'b', mergedInto: 'a' })), 'none')
})

// ── 找合併對象 ────────────────────────────────────────────

test('同時命中多筆時取最早建檔的當主檔，場合與筆記都在舊的那筆', () => {
  const incoming = mk({ id: 'new', createdAt: { seconds: 3000 } })
  const older = mk({ id: 'old', createdAt: { seconds: 1000 }, source: '展場A' })
  const middle = mk({ id: 'mid', createdAt: { seconds: 2000 }, source: '展場B' })
  const { auto } = findMergeTargets(incoming, [middle, older])
  assert.equal(auto?.id, 'old')
})

test('建議對象會全部列出來', () => {
  const incoming = mk({ id: 'new', nameZh: '王小明' })
  const s1 = mk({ id: 's1', nameZh: '王小華' })
  const s2 = mk({ id: 's2', nameZh: '王小強' })
  const { auto, suggest } = findMergeTargets(incoming, [s1, s2])
  assert.equal(auto, null)
  assert.deepEqual(suggest.map(c => c.id), ['s1', 's2'])
})

// ── 盤點整份名單 ──────────────────────────────────────────

test('盤點不會把同一組算兩次，且自動的排在前面', () => {
  const all = [
    mk({ id: 'a1', nameZh: '王小明', createdAt: { seconds: 1000 } }),
    mk({ id: 'a2', nameZh: '王小明', createdAt: { seconds: 2000 } }),
    mk({ id: 's1', nameZh: '李小華', mobile: '0955-111222', officePhone: '', createdAt: { seconds: 3000 } }),
    mk({ id: 's2', nameZh: '李小強', mobile: '0955-111222', officePhone: '', createdAt: { seconds: 4000 } }),
  ]
  const groups = findDuplicateGroups(all)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].verdict, 'auto')
  assert.equal(groups[0].primary.id, 'a1', 'primary 要是建檔較早的那筆')
  assert.equal(groups[0].secondary.id, 'a2')
  assert.equal(groups[1].verdict, 'suggest')
})

test('已合併的筆不再出現在盤點結果裡', () => {
  const all = [
    mk({ id: 'a1', createdAt: { seconds: 1000 } }),
    mk({ id: 'a2', createdAt: { seconds: 2000 }, mergedInto: 'a1' }),
  ]
  assert.equal(findDuplicateGroups(all).length, 0)
})

// ── 合併計畫 ──────────────────────────────────────────────

const FIELDS = ['company', 'title', 'email', 'mobile', 'officePhone', 'address']

test('只補空欄位，不覆蓋既有內容', () => {
  const primary = { ...mk(), email: '', title: '經理' } as never
  const secondary = { ...mk({ id: 'b' }), email: 'a@example.com', title: '副總' } as never
  const { updates } = planMerge(primary, secondary, FIELDS)
  assert.equal(updates.email, 'a@example.com', '空的要補上')
  assert.ok(!('title' in updates), '已有內容不可以被蓋掉，primary 可能已人工修正過')
})

test('場合是「其他」時可以被真實場合取代，反過來不行', () => {
  const a = planMerge({ ...mk({ source: '其他' }) } as never, { ...mk({ id: 'b', source: '展場A' }) } as never, FIELDS)
  assert.equal(a.updates.source, '展場A')

  const b = planMerge({ ...mk({ source: '展場A' }) } as never, { ...mk({ id: 'b', source: '其他' }) } as never, FIELDS)
  assert.ok(!('source' in b.updates), '真實場合不可以被「其他」蓋掉')
})

test('筆記兩邊合併並去掉完全重複的句子', () => {
  const primary = { ...mk({ notes: ['聊過自動化'] }) } as never
  const secondary = { ...mk({ id: 'b', notes: ['聊過自動化', '想找配料系統'] }) } as never
  const { updates } = planMerge(primary, secondary, FIELDS)
  assert.deepEqual(updates.notes, ['聊過自動化', '想找配料系統'])
})

test('狀態只能往前，不會被新掃的名片退回待跟進', () => {
  const a = planMerge({ ...mk({ status: '已提案' }) } as never, { ...mk({ id: 'b', status: '待跟進' }) } as never, FIELDS)
  assert.ok(!('status' in a.updates), '已提案不可以退回待跟進')

  const b = planMerge({ ...mk({ status: '待跟進' }) } as never, { ...mk({ id: 'b', status: '成交' }) } as never, FIELDS)
  assert.equal(b.updates.status, '成交')
})

test('另一張名片原圖會留下來當核對用的對照', () => {
  const primary = { ...mk({ cardImageUrl: 'https://example.com/1.jpg' }) } as never
  const secondary = { ...mk({ id: 'b', cardImageUrl: 'https://example.com/2.jpg' }) } as never
  const { updates } = planMerge(primary, secondary, FIELDS)
  assert.deepEqual(updates.extraCardImages, ['https://example.com/2.jpg'])
})

test('兩邊內容一樣時不產生任何更新，避免寫入無意義的版本', () => {
  const { updates, changes } = planMerge({ ...mk() } as never, { ...mk({ id: 'b' }) } as never, FIELDS)
  assert.deepEqual(updates, {})
  assert.deepEqual(changes, [])
})

test('預覽文字要標出哪幾組不用判斷、哪幾組要判斷', () => {
  const auto = describeGroup({ verdict: 'auto', primary: mk({ id: 'a' }), secondary: mk({ id: 'b' }) })
  assert.match(auto, /同一人/)
  const suggest = describeGroup({ verdict: 'suggest', primary: mk({ id: 'a' }), secondary: mk({ id: 'b', nameZh: '李小華' }) })
  assert.match(suggest, /要你判斷/)
  assert.match(suggest, /王小明/)
  assert.match(suggest, /李小華/)
})

// 這條擋的是一個會讓功能靜默失效的錯誤。
//
// findMergeForNewCard 是在建檔之後呼叫的，候選名單裡包含剛建好的那一筆。
// 它跟自己姓名電話完全相同，所以如果沒排除，auto 永遠有值，
// 連帶讓「手機撞號但姓名不同」的建議永遠不會出現（suggest 的條件是沒有 auto）。
// 功能看起來正常上線，但那顆按鈕一次都不會跑出來。
test('候選名單含有自己時不可以跟自己配對，否則合併建議永遠不會出現', () => {
  const self = mk({ id: 'self', nameZh: '王小明', mobile: '0912-345678', createdAt: { seconds: 9999 } })
  const other = mk({ id: 'other', nameZh: '李小華', mobile: '0912-345678', officePhone: '', createdAt: { seconds: 1000 } })

  // 自己對自己：id 相同就該回 none
  assert.equal(classify(self, self), 'none')

  // 帶著自己的 id 去找，應該找不到 auto，但要找到 suggest
  const { auto, suggest } = findMergeTargets(self, [self, other])
  assert.equal(auto, null, '不可以把自己當成合併對象')
  assert.deepEqual(suggest.map(c => c.id), ['other'], '排除自己之後建議才會出現')
})
