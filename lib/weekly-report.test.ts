import assert from 'node:assert'
import { test } from 'node:test'
import { buildWeeklyReport, weekStartMs } from './weekly-report.ts'

const NOW = new Date('2026-09-09T10:00:00+08:00') // 週三
const day = (n: number) => NOW.getTime() - n * 86400000

const contact = (over: Partial<Parameters<typeof buildWeeklyReport>[1][number]> = {}) => ({
  name: '王大明', company: 'A公司', score: 7, category: '潛在客戶',
  status: '待跟進', source: 'BNI', isDobBizPotential: false,
  createdAtMs: day(100), followUpAtMs: day(50), ...over,
})

test('週起算日是台灣時間的週一', () => {
  const start = new Date(weekStartMs(NOW))
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(start)
  assert.equal(wd, 'Mon')
})

test('完全沒東西時回傳 null，不發空報告', () => {
  assert.equal(buildWeeklyReport(NOW, [], [], []), null)
})

test('本週簽案與收款會列出金額', () => {
  const r = buildWeeklyReport(NOW, [], [
    { client: '大展精密', amount: 180000, product: '網頁', signedAtMs: day(1) },
  ], [
    { client: '偉凌實業', amount: 90000, paidAtMs: day(2) },
  ])!
  assert.ok(r.includes('簽案 1 筆｜180,000 元'))
  assert.ok(r.includes('收款 1 筆｜90,000 元'))
})

test('上週的簽案不計入本週', () => {
  const r = buildWeeklyReport(NOW, [contact()], [
    { client: '舊案', amount: 500000, product: '網頁', signedAtMs: day(30) },
  ], [])!
  assert.ok(!r.includes('500,000'))
})

test('本週新增依場合分組', () => {
  const r = buildWeeklyReport(NOW, [
    contact({ createdAtMs: day(1), source: '五金展' }),
    contact({ createdAtMs: day(1), source: '五金展' }),
    contact({ createdAtMs: day(2), source: 'BNI' }),
  ], [], [])!
  assert.ok(r.includes('本週新增 3 位'))
  assert.ok(r.includes('五金展 2 位'))
  assert.ok(r.includes('BNI 1 位'))
})

test('逾期未跟進依逾期天數排序，最久的在前', () => {
  const r = buildWeeklyReport(NOW, [
    contact({ name: '近期', followUpAtMs: day(3) }),
    contact({ name: '最久', followUpAtMs: day(40) }),
  ], [], [])!
  assert.ok(r.indexOf('最久') < r.indexOf('近期'))
  assert.ok(r.includes('逾期 40 天'))
})

test('已成交的人不列入逾期', () => {
  const r = buildWeeklyReport(NOW, [
    contact({ name: '已成交客戶', status: '成交', followUpAtMs: day(90) }),
    contact({ name: '待跟進的', followUpAtMs: day(10) }),
  ], [], [])!
  assert.ok(!r.includes('已成交客戶'))
  assert.ok(r.includes('待跟進的'))
})

test('DobBiz 潛力只列還沒接觸的，依評分排序', () => {
  const r = buildWeeklyReport(NOW, [
    contact({ name: '高分潛力', score: 9, isDobBizPotential: true }),
    contact({ name: '已聯絡過', score: 10, isDobBizPotential: true, status: '已聯絡' }),
  ], [], [])!
  assert.ok(r.includes('DobBiz 潛力尚未接觸 1 位'))
  assert.ok(r.includes('高分潛力'))
  assert.ok(!r.includes('已聯絡過'))
})

test('結尾一定給一個明確動作', () => {
  const r = buildWeeklyReport(NOW, [contact({ name: '林志明', company: '大展精密' })], [], [])!
  assert.ok(r.includes('🎯 這週先做這一件：聯絡 林志明（大展精密）'))
})

test('只有簽案沒有人脈時仍會產出報告', () => {
  const r = buildWeeklyReport(NOW, [], [
    { client: 'X', amount: 1000, product: '網頁', signedAtMs: day(1) },
  ], [])
  assert.ok(r && r.includes('本週業績'))
})
