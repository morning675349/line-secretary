// 限流並行 + 時間預算的批次執行器。
//
// 存在理由：Vercel Hobby 方案的函式上限是 60 秒，一張名片辨識要 8 到 15 秒。
// 原本的逐張序列處理超過 4 張就會被砍，而且是靜默被砍，使用者不知道哪幾張沒進去。
// 這裡做兩件事：(1) 限流並行把吞吐拉高 (2) 逼近時限就停手並明確回報哪些沒處理。

export interface BatchOutcome<T, R> {
  done: Array<{ item: T; result: R }>
  failed: Array<{ item: T; error: string }>
  skipped: T[]
}

export interface BatchOptions {
  concurrency: number
  /** 絕對時間（毫秒）。超過這個時間就不再開始新的工作 */
  deadlineAt: number
  /** 可注入的時鐘，測試用 */
  now?: () => number
}

/**
 * 併發執行 worker，超過 deadline 就停止「開始新工作」（已在跑的會等它做完）。
 *
 * 注意：deadline 只擋「還沒開始」的項目，不會中斷進行中的工作。
 * 所以 deadline 要抓在真正上限之前，留出最長一件工作的時間加上收尾推播的時間。
 */
export async function runBatch<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  opts: BatchOptions
): Promise<BatchOutcome<T, R>> {
  const now = opts.now ?? (() => Date.now())
  const outcome: BatchOutcome<T, R> = { done: [], failed: [], skipped: [] }

  let cursor = 0
  const take = (): T | undefined => (cursor < items.length ? items[cursor++] : undefined)

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
    for (;;) {
      const item = take()
      if (item === undefined) return
      if (now() >= opts.deadlineAt) {
        outcome.skipped.push(item)
        continue
      }
      try {
        outcome.done.push({ item, result: await worker(item) })
      } catch (err) {
        outcome.failed.push({ item, error: err instanceof Error ? err.message : String(err) })
      }
    }
  })

  await Promise.all(workers)
  return outcome
}
