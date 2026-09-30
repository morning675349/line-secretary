import assert from 'node:assert'
import { test } from 'node:test'
import { rankExpoContacts, tierOf, buildExpoReport } from './expo-report.ts'
import type { ExpoContactLite } from './expo-report.ts'

const mk = (over: Partial<ExpoContactLite>): ExpoContactLite => ({
  id: 'c1', name: '某人', company: '某公司', score: 5, industry: '製造業',
  isDobBizPotential: false, noteCount: 0, hasEmail: false, ...over,
})

test('分級門檻', () => {
  assert.equal(tierOf(10), 'A'); assert.equal(tierOf(8), 'A')
  assert.equal(tierOf(7), 'B'); assert.equal(tierOf(6), 'B')
  assert.equal(tierOf(5), 'C'); assert.equal(tierOf(1), 'C')
})

test('現場聊過的權重高於單純高分', () => {
  const ranked = rankExpoContacts([
    mk({ name: '高分沒聊過', score: 9 }),
    mk({ name: '中分有聊過', score: 7, noteCount: 2 }),
  ])
  assert.equal(ranked[0].name, '中分有聊過')
  assert.ok(ranked[0].reasons.includes('現場聊過'))
})

test('DobBiz 潛力與 Email 都會加權', () => {
  const ranked = rankExpoContacts([
    mk({ name: '普通', score: 7 }),
    mk({ name: 'DobBiz', score: 7, isDobBizPotential: true }),
  ])
  assert.equal(ranked[0].name, 'DobBiz')
  assert.ok(ranked[0].reasons.includes('DobBiz 潛力'))
})

test('同分時以名片評分決勝', () => {
  const ranked = rankExpoContacts([
    mk({ name: '低分有聊', score: 5, noteCount: 1 }),   // 5+3=8
    mk({ name: '高分沒聊', score: 8 }),                  // 8
  ])
  assert.equal(ranked[0].name, '高分沒聊')
})

test('報告包含關鍵數字與建議順序', () => {
  const report = buildExpoReport('五金展', [
    mk({ name: '林志明', company: '大展精密', score: 9, noteCount: 1, isDobBizPotential: true, hasEmail: true }),
    mk({ name: '王小華', score: 6, industry: '貿易商' }),
    mk({ name: '陳大同', score: 3 }),
  ])
  assert.match(report, /共 3 張名片/)
  assert.match(report, /A 級 1 位/)
  assert.match(report, /現場聊過（有留筆記）1 位/)
  assert.match(report, /DobBiz 潛力 1 位/)
  assert.match(report, /1\. 林志明（大展精密）/)
  assert.match(report, /匯出 五金展 名單/)
})

test('沒有名片時給明確訊息而不是空報告', () => {
  assert.match(buildExpoReport('某展', []), /沒有任何名片紀錄/)
})
