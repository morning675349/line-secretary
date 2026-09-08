import assert from 'node:assert'
import { test } from 'node:test'
import { runBatch } from './batch.ts'

test('全部成功時依序收集結果', async () => {
  const r = await runBatch([1, 2, 3], async n => n * 2, { concurrency: 2, deadlineAt: Date.now() + 60000 })
  assert.equal(r.done.length, 3)
  assert.equal(r.failed.length, 0)
  assert.equal(r.skipped.length, 0)
  assert.deepEqual(r.done.map(d => d.result).sort(), [2, 4, 6])
})

test('個別失敗不影響其他項目', async () => {
  const r = await runBatch([1, 2, 3], async n => {
    if (n === 2) throw new Error('壞掉了')
    return n
  }, { concurrency: 3, deadlineAt: Date.now() + 60000 })
  assert.equal(r.done.length, 2)
  assert.equal(r.failed.length, 1)
  assert.equal(r.failed[0].item, 2)
  assert.equal(r.failed[0].error, '壞掉了')
})

test('超過時限的項目列入 skipped 而不是靜默消失', async () => {
  let clock = 1000
  const r = await runBatch([1, 2, 3, 4], async n => n, {
    concurrency: 1,
    deadlineAt: 1000 + 25,
    now: () => (clock += 10), // 每次取用推進 10ms
  })
  assert.ok(r.skipped.length > 0, '應該要有被跳過的項目')
  assert.equal(r.done.length + r.failed.length + r.skipped.length, 4, '每一項都要有著落')
})

test('併發數真的有生效', async () => {
  let running = 0
  let peak = 0
  await runBatch([1, 2, 3, 4, 5, 6], async () => {
    running++
    peak = Math.max(peak, running)
    await new Promise(r => setTimeout(r, 10))
    running--
  }, { concurrency: 3, deadlineAt: Date.now() + 60000 })
  assert.equal(peak, 3)
})

test('空清單不會爆', async () => {
  const r = await runBatch([], async (n: number) => n, { concurrency: 3, deadlineAt: Date.now() + 1000 })
  assert.deepEqual(r, { done: [], failed: [], skipped: [] })
})
