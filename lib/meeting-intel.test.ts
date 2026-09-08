// 執行：npm test
import assert from 'node:assert'
import { test } from 'node:test'
import { companyCore, contactMatchesEvent, formatEventIntel, stripNoteTimestamp, daysSince } from './meeting-intel.ts'

test('公司贅字要剝掉', () => {
  assert.equal(companyCore('大展精密工業股份有限公司'), '大展精密工業')
  assert.equal(companyCore('偉凌實業有限公司'), '偉凌')
  assert.equal(companyCore('奇策整合行銷'), '奇策整合行銷')
})

test('行程標題含全名時比對成功', () => {
  assert.ok(contactMatchesEvent('與林志明討論官網改版', { nameZh: '林志明', company: '大展精密工業' }))
})

test('行程標題含公司核心名時比對成功', () => {
  assert.ok(contactMatchesEvent('大展精密 網站需求確認', { nameZh: '林志明', company: '大展精密工業股份有限公司' }))
})

test('只有姓氏不算命中（避免林董、林口誤判）', () => {
  assert.ok(!contactMatchesEvent('與林董開會', { nameZh: '林志明', company: '大展精密工業' }))
  assert.ok(!contactMatchesEvent('林口廠參訪', { nameZh: '林志明', company: '大展精密工業' }))
})

test('過於通用的公司名不採用', () => {
  assert.ok(!contactMatchesEvent('台灣製造業論壇', { nameZh: '王大明', company: '台灣有限公司' }))
  assert.ok(!contactMatchesEvent('科技業聚會', { nameZh: '王大明', company: '科技股份有限公司' }))
})

test('英文公司名不分大小寫', () => {
  assert.ok(contactMatchesEvent('Meeting with ACME today', { nameEn: 'John', companyEn: 'Acme Ltd' }))
})

test('沒有對應人脈時只輸出行程本身', () => {
  const lines = formatEventIntel({ title: 'BNI 例會', time: '07:00', location: '台中林酒店' }, [])
  assert.deepEqual(lines, ['07:00 BNI 例會 @ 台中林酒店'])
})

test('有對應人脈時附上完整情報', () => {
  const lines = formatEventIntel(
    { title: '與大展精密洽談', time: '14:00', location: '客戶端' },
    [{
      name: '林志明', company: '大展精密工業', title: '總經理',
      score: 8, category: '潛在客戶', status: '待跟進', source: 'BNI 台中南區例會',
      followUpSuggestion: '帶製造業改版案例', lastNote: '想做官網，預算約三十萬',
      notesCount: 2, knownForDays: 42,
    }]
  )
  const joined = lines.join('\n')
  assert.ok(joined.includes('林志明 總經理（大展精密工業）'))
  assert.ok(joined.includes('8/10 潛在客戶｜待跟進'))
  assert.ok(joined.includes('42 天前在「BNI 台中南區例會」認識'))
  assert.ok(joined.includes('想做官網'))
})

test('場合是預設值「其他」時不顯示認識場合那行', () => {
  const lines = formatEventIntel(
    { title: '與王大明開會', time: '10:00', location: '' },
    [{
      name: '王大明', company: 'A公司', title: '', score: 5, category: '待觀察',
      status: '待跟進', source: '其他', followUpSuggestion: '', lastNote: '',
      notesCount: 0, knownForDays: 3,
    }]
  )
  assert.ok(!lines.join('\n').includes('認識'))
})

test('筆記的時間戳前綴要拿掉', () => {
  assert.equal(stripNoteTimestamp('[2026/7/29 上午10:30:00] 想做官網'), '想做官網')
  assert.equal(stripNoteTimestamp('沒有前綴的筆記'), '沒有前綴的筆記')
})

test('認識天數計算', () => {
  assert.equal(daysSince(new Date('2026-09-01T00:00:00+08:00'), new Date('2026-09-09T00:00:00+08:00')), 8)
  assert.equal(daysSince(new Date('2026-09-09T00:00:00+08:00'), new Date('2026-09-01T00:00:00+08:00')), 0)
})
