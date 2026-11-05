import { test } from 'node:test'
import assert from 'node:assert'
import { rankPursuit, summarizePursuit, formatPursuitReview } from './pursuit.ts'
import type { PursuitLite } from './pursuit.ts'

// 全部假資料，不帶任何真實聯絡人內容
const mk = (over: Partial<PursuitLite> = {}): PursuitLite => ({
  id: 'c1', name: '王小明', company: '測試精密工業',
  score: 8, category: '潛在客戶', source: '工具機展',
  isDobBizPotential: false, noteCount: 0,
  hasEmail: true, hasPhone: true, daysSinceCreated: 10,
  ...over,
})

// ── 分組 ──────────────────────────────────────────────────

test('高分又聯絡得到的人進「該追」', () => {
  assert.equal(rankPursuit([mk({ score: 9 })])[0].band, '該追')
})

// 追不動的人放在該追裡只會讓清單失去可信度：
// 使用者點開發現沒電話沒信箱，下次就不會再相信這份清單。
test('完全聯絡不到的直接先放，不管分數多高', () => {
  const r = rankPursuit([mk({ score: 10, hasEmail: false, hasPhone: false })])[0]
  assert.equal(r.band, '先放')
  assert.ok(r.reasons.includes('沒有聯絡方式'))
})

// 2026-11-05 用 163 筆實測，絕對門檻切出 102 位該追（63%），等於沒分。
// 所有訊號都偏高，只有相對排名切得出一份做得完的清單。
test('分組看排名不看絕對分數，名額固定才做得完', () => {
  const many = Array.from({ length: 100 }, (_, i) =>
    mk({ id: `c${i}`, score: 9, noteCount: 1 }))
  const ranked = rankPursuit(many, 20)
  assert.equal(ranked.filter(r => r.band === '該追').length, 20,
    '就算 100 個人全是 9 分又都聊過，該追也只給 20 個')
})

test('人數少於名額時不會硬湊，有幾個算幾個', () => {
  const few = [mk({ id: 'a' }), mk({ id: 'b' })]
  assert.equal(rankPursuit(few, 20).filter(r => r.band === '該追').length, 2)
})

test('低分進「先放」', () => {
  assert.equal(rankPursuit([mk({ score: 5 })])[0].band, '先放')
  assert.equal(rankPursuit([mk({ score: 2 })])[0].band, '先放')
})

test('待觀察不管幾分都先放', () => {
  assert.equal(rankPursuit([mk({ score: 10, category: '待觀察' })])[0].band, '先放')
})

// ── 排序與理由 ────────────────────────────────────────────

// 跟 expo-report 一致的信念：有筆記代表你真的停下來談過，
// 那是對方給的訊號，比 AI 從名片猜出來的評分可信。
test('聊過的人排在同分沒聊過的前面，並標出理由', () => {
  const chatted = mk({ id: 'chatted', noteCount: 2 })
  const silent = mk({ id: 'silent', noteCount: 0 })
  const r = rankPursuit([silent, chatted])
  assert.equal(r[0].id, 'chatted')
  assert.ok(r[0].reasons.includes('聊過'))
})

test('DobBiz 潛力會加權並標出來', () => {
  const r = rankPursuit([mk({ isDobBizPotential: true })])[0]
  assert.ok(r.reasons.includes('DobBiz 潛力'))
  assert.ok(r.priority > mk().score)
})

test('潛在客戶與引薦來源加權，其他分類不加', () => {
  const base = rankPursuit([mk({ category: '同業' })])[0].priority
  for (const cat of ['潛在客戶', '引薦來源']) {
    assert.ok(rankPursuit([mk({ category: cat })])[0].priority > base, `${cat} 應該加權`)
  }
})

// 放久了確實冷掉，但高分的好名單不該被時間埋掉，所以只做輕微衰減。
test('時間只做輕微衰減，不會蓋過聊過這個訊號', () => {
  const oldChatted = mk({ id: 'old', noteCount: 1, daysSinceCreated: 200 })
  const freshSilent = mk({ id: 'fresh', noteCount: 0, daysSinceCreated: 1 })
  assert.equal(rankPursuit([freshSilent, oldChatted])[0].id, 'old')
})

test('越久的排越後面，其他條件相同時', () => {
  const a = mk({ id: 'new', daysSinceCreated: 5 })
  const b = mk({ id: 'old', daysSinceCreated: 200 })
  assert.deepEqual(rankPursuit([b, a]).map(r => r.id), ['new', 'old'])
})

// ── 總覽 ──────────────────────────────────────────────────

test('三組的數量加起來等於總數，不能有人憑空消失', () => {
  const contacts = [
    mk({ id: 'a', score: 9 }),
    mk({ id: 'b', score: 6 }),
    mk({ id: 'c', score: 3 }),
    mk({ id: 'd', score: 10, category: '待觀察' }),
  ]
  const s = summarizePursuit(contacts)
  assert.equal(s.total, 4)
  assert.equal(s.counts.該追 + s.counts.可追 + s.counts.先放, 4)
})

test('場合分布依「帶來幾位該追」排序，那才是值得再去的場合', () => {
  const contacts = [
    mk({ id: '1', source: '甲展', score: 9 }),
    mk({ id: '2', source: '甲展', score: 9 }),
    mk({ id: '3', source: '乙會', score: 9 }),
    mk({ id: '4', source: '乙會', score: 3 }),
    mk({ id: '5', source: '乙會', score: 3 }),
  ]
  const s = summarizePursuit(contacts)
  assert.equal(s.bySource[0].source, '甲展')
  assert.equal(s.bySource[0].worth, 2)
})

test('沒有場合的歸到未判定，不要變成空字串', () => {
  const s = summarizePursuit([mk({ source: '' })])
  assert.equal(s.bySource[0].source, '未判定')
})

test('只列該追的前幾位，不是全部倒出來', () => {
  const many = Array.from({ length: 30 }, (_, i) => mk({ id: `c${i}`, score: 9 }))
  assert.equal(summarizePursuit(many).top.length, 8)
  assert.equal(summarizePursuit(many, 3).top.length, 3)
})

// 使用者真正需要的不是一份待辦，是「這 160 人裡面有 83 個你可以不用管」
// 這句話。把壓力拿掉，剩下的二十幾個才追得動。
test('總覽一定要把「先放」的數字講出來，那是最重要的資訊', () => {
  const contacts = [
    ...Array.from({ length: 5 }, (_, i) => mk({ id: `a${i}`, score: 9 })),
    ...Array.from({ length: 20 }, (_, i) => mk({ id: `c${i}`, score: 3 })),
  ]
  const text = formatPursuitReview(summarizePursuit(contacts))
  assert.match(text, /該追 5 位/)
  assert.match(text, /先放 20 位/)
})

test('總覽結尾要給下一步，不是只報數字', () => {
  const text = formatPursuitReview(summarizePursuit([mk({ score: 9 })]))
  assert.match(text, /排下週|看可追的/)
})

test('沒有資料時給一句話，不要印空表格', () => {
  assert.equal(formatPursuitReview(summarizePursuit([])), '目前沒有待跟進的聯絡人。')
})

test('公司名空白時不印空括號', () => {
  const text = formatPursuitReview(summarizePursuit([mk({ company: '' })]))
  assert.doesNotMatch(text, /（）/)
  assert.match(text, /王小明/)
})
