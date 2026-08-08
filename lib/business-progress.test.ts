import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeProgress, formatProgress, adsStatusLine, taipeiYm,
  MILESTONE_MONTHLY,
} from './business-progress.ts'
import type { DealLite, PaymentLite } from './business-progress.ts'

function deal(signedYm: string, amount: number, product = '網頁', delivery = '內部'): DealLite {
  return { signedYm, amount, product, delivery }
}
function pay(paidYm: string, amount: number): PaymentLite {
  return { paidYm, amount }
}

test('空資料：所有觸發器歸零', () => {
  const p = computeProgress([], [], '2026-08')
  assert.equal(p.milestoneStreak, 0)
  assert.equal(p.milestoneGap, MILESTONE_MONTHLY)
  assert.equal(p.outsourceStreak, 0)
  assert.equal(p.seoActiveCount, 0)
  assert.equal(p.months.length, 6)
  assert.equal(p.months[0].ym, '2026-08')
  assert.equal(p.months[5].ym, '2026-03')
})

test('月份序列跨年正確', () => {
  const p = computeProgress([], [], '2026-01')
  assert.deepEqual(p.months.map(m => m.ym), ['2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08'])
})

test('本月簽約加總與缺口', () => {
  const p = computeProgress([deal('2026-08', 120_000), deal('2026-08', 140_000)], [], '2026-08')
  assert.equal(p.months[0].signedTotal, 260_000)
  assert.equal(p.months[0].signedCount, 2)
  assert.equal(p.milestoneGap, 120_000)
  assert.equal(p.milestoneCurrentMet, false)
})

test('里程碑：本月未達標不斷開之前的連續紀錄', () => {
  const deals = [
    deal('2026-07', 400_000),
    deal('2026-06', 390_000),
    deal('2026-08', 100_000), // 本月進行中，尚未達標
  ]
  const p = computeProgress(deals, [], '2026-08')
  assert.equal(p.milestoneStreak, 2)
  assert.equal(p.milestoneCurrentMet, false)
})

test('里程碑：本月達標則納入連續計算', () => {
  const deals = [deal('2026-08', 380_000), deal('2026-07', 400_000), deal('2026-06', 390_000)]
  const p = computeProgress(deals, [], '2026-08')
  assert.equal(p.milestoneStreak, 3)
  assert.equal(p.milestoneCurrentMet, true)
})

test('里程碑：中斷月份會歸零重算', () => {
  const deals = [deal('2026-07', 400_000), deal('2026-06', 100_000), deal('2026-05', 500_000)]
  const p = computeProgress(deals, [], '2026-08')
  assert.equal(p.milestoneStreak, 1)
})

test('外包溢出連續月數', () => {
  const deals = [
    deal('2026-07', 120_000, '網頁', '外包'), deal('2026-07', 120_000, '網頁', '外包'),
    deal('2026-06', 120_000, '網頁', '外包'), deal('2026-06', 90_000, '網頁', '外包'),
    deal('2026-08', 120_000, '網頁', '內部'),
  ]
  const p = computeProgress(deals, [], '2026-08')
  assert.equal(p.outsourceStreak, 2)
  assert.equal(p.months[0].outsourceCount, 0)
})

test('SEO 年約：12 個月內有效，過期不計', () => {
  const deals = [
    deal('2026-08', 120_000, 'SEO年約'),
    deal('2026-01', 120_000, 'SEO年約'),
    deal('2025-09', 120_000, 'SEO年約'), // 12 個月窗內（2025-09 起算）
    deal('2025-08', 120_000, 'SEO年約'), // 窗外，已過期
    deal('2026-08', 120_000, '網頁'),
  ]
  const p = computeProgress(deals, [], '2026-08')
  assert.equal(p.seoActiveCount, 3)
})

test('實收與簽約分開統計', () => {
  const p = computeProgress([deal('2026-08', 120_000)], [pay('2026-08', 48_000)], '2026-08')
  assert.equal(p.months[0].paidTotal, 48_000)
  assert.equal(p.months[0].signedTotal, 120_000)
})

test('formatProgress 輸出關鍵欄位', () => {
  const deals = [deal('2026-08', 260_000), deal('2026-08', 120_000, 'SEO年約')]
  const p = computeProgress(deals, [pay('2026-08', 100_000)], '2026-08')
  const text = formatProgress(p, adsStatusLine(new Date('2026-08-08T12:00:00+08:00')))
  assert.ok(text.includes('38 萬'))
  assert.ok(text.includes('本月簽約 38 萬'))
  assert.ok(text.includes('1/7 家'))
  assert.ok(text.includes('8/31'))
})

test('adsStatusLine 三個時期', () => {
  assert.ok(adsStatusLine(new Date('2026-08-10T12:00:00+08:00')).includes('點火前置'))
  assert.ok(adsStatusLine(new Date('2026-10-05T12:00:00+08:00')).includes('第 2/3 個月'))
  assert.ok(adsStatusLine(new Date('2026-12-10T12:00:00+08:00')).includes('結束'))
})

test('taipeiYm 時區換算', () => {
  // UTC 8/31 22:00 = 台北 9/1 06:00
  assert.equal(taipeiYm(new Date('2026-08-31T22:00:00Z')), '2026-09')
  assert.equal(taipeiYm(new Date('2026-08-31T10:00:00Z')), '2026-08')
})
