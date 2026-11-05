import { test } from 'node:test'
import assert from 'node:assert'
import {
  daysInStatus, isStageOverdue, normalizeFollowUpDate, formatDueLine, STAGE_ALERT_DAYS,
} from './followup.ts'
import type { StallCandidate } from './followup.ts'

const DAY = 86_400_000
// 2026-11-05 12:00 Taipei
const NOW = Date.UTC(2026, 10, 5, 4, 0, 0)

const mk = (over: Partial<StallCandidate> = {}): StallCandidate => ({
  id: 'c1', nameZh: '王小明', company: '測試精密工業',
  status: '已聯絡', score: 8,
  statusChangedAtMs: NOW - 20 * DAY,
  createdAtMs: NOW - 60 * DAY,
  ...over,
})

// ── 停留天數 ──────────────────────────────────────────────

test('算得出在目前狀態停留幾天', () => {
  assert.equal(daysInStatus(mk({ statusChangedAtMs: NOW - 20 * DAY }), NOW), 20)
})

// 這條擋的是最容易漏掉的一批：statusChangedAt 是後來才加的欄位，
// 既有聯絡人都沒有。不退回 createdAt 的話，放最久的那批反而全部不會被提醒。
test('沒有狀態變更時間時退回建檔時間，舊資料才不會靜默消失', () => {
  const c = mk({ statusChangedAtMs: undefined, createdAtMs: NOW - 45 * DAY })
  assert.equal(daysInStatus(c, NOW), 45)
})

test('兩個時間都沒有就回 null，不要亂猜', () => {
  assert.equal(daysInStatus(mk({ statusChangedAtMs: undefined, createdAtMs: undefined }), NOW), null)
})

test('未來的時間視為無效，不要算出負數天數', () => {
  assert.equal(daysInStatus(mk({ statusChangedAtMs: NOW + 5 * DAY }), NOW), null)
})

// ── 階段停留提醒 ──────────────────────────────────────────

test('已聯絡超過門檻才標警示', () => {
  const under = mk({ statusChangedAtMs: NOW - (STAGE_ALERT_DAYS.已聯絡 - 1) * DAY })
  const over = mk({ statusChangedAtMs: NOW - (STAGE_ALERT_DAYS.已聯絡 + 3) * DAY })
  assert.equal(isStageOverdue(under, NOW), false)
  assert.equal(isStageOverdue(over, NOW), true)
})

test('已提案的門檻比已聯絡長，提案後要留給對方討論的時間', () => {
  assert.ok(STAGE_ALERT_DAYS.已提案 > STAGE_ALERT_DAYS.已聯絡)
  assert.equal(isStageOverdue(mk({ status: '已提案', statusChangedAtMs: NOW - 15 * DAY }), NOW), false)
})

test('待跟進與終點狀態不標警示', () => {
  for (const status of ['待跟進', '成交', '引薦完成', '婉拒']) {
    const c = mk({ status, statusChangedAtMs: NOW - 365 * DAY })
    assert.equal(isStageOverdue(c, NOW), false, `${status} 不該標警示`)
  }
})

// ── 日期驗證 ──────────────────────────────────────────────

test('接受合法的未來日期，並對齊到台北零點', () => {
  const r = normalizeFollowUpDate('2026-12-01', NOW)
  assert.ok(r.ok)
  // 台北 12/01 00:00 等於 UTC 11/30 16:00
  assert.equal(r.ms, Date.UTC(2026, 10, 30, 16, 0, 0))
})

// 設零點而不是當下時刻：早報比對 followUpAt <= now，在早上八點跑。
// 設成當下時刻會讓提醒延到隔天才出現。
test('當天也可以排，而且當天早報就要看得到', () => {
  const r = normalizeFollowUpDate('2026-11-05', NOW)
  assert.ok(r.ok)
  assert.ok(r.ms! <= NOW, '當天排的跟進，當天的早報就要撈得到')
})

// 模型算日期最常見的錯就是年份用成去年。默默接受的話那個人會立刻
// 出現在「今日需跟進」，看起來像系統壞掉，而且查不出原因。
test('過去的日期一律拒絕，因為那幾乎都是年份算錯', () => {
  const r = normalizeFollowUpDate('2025-12-01', NOW)
  assert.ok(!r.ok)
  assert.match(r.reason!, /年份/)
})

test('擋掉不存在的日期，不要被 Date 自動進位騙過去', () => {
  assert.ok(!normalizeFollowUpDate('2027-02-30', NOW).ok)
  assert.ok(!normalizeFollowUpDate('2027-13-01', NOW).ok)
})

test('格式不對直接回報，不要硬解析', () => {
  for (const bad of ['下週三', '2026/12/01', '12-01', '', '2026-12-1']) {
    assert.ok(!normalizeFollowUpDate(bad, NOW).ok, `${bad} 應該被拒絕`)
  }
})

test('太遠的日期要攔，多半是算錯', () => {
  assert.ok(!normalizeFollowUpDate('2030-01-01', NOW).ok)
})

// ── 早報的一行 ────────────────────────────────────────────

// 「他在哪一階段卡多久」比「他是誰」更能決定今天要用什麼方式聯絡：
// 卡在已提案三週要打電話，剛加的名片寄封信就好。
test('跟進清單那一行要寫出階段與停留天數', () => {
  const line = formatDueLine(mk({ status: '已提案', statusChangedAtMs: NOW - 30 * DAY }), NOW)
  assert.match(line, /王小明/)
  assert.match(line, /測試精密工業/)
  assert.match(line, /已提案/)
  assert.match(line, /已 30 天/)
  assert.match(line, /⚠️/, '超過門檻要標警示')
})

test('待跟進不重複印階段名稱，那是預設狀態', () => {
  const line = formatDueLine(mk({ status: '待跟進', statusChangedAtMs: NOW - 3 * DAY }), NOW)
  assert.doesNotMatch(line, /待跟進/)
  assert.match(line, /已 3 天/)
})

test('當天才建檔的不印天數，印「已 0 天」很怪', () => {
  const line = formatDueLine(mk({ status: '待跟進', statusChangedAtMs: NOW }), NOW)
  assert.doesNotMatch(line, /已 0 天/)
})

test('沒有時間資料時照樣印得出一行，不會壞掉', () => {
  const line = formatDueLine(mk({ statusChangedAtMs: undefined, createdAtMs: undefined }), NOW)
  assert.match(line, /王小明/)
})
