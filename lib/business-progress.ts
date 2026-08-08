// 業務戰情的進度計算：純函式、零 I/O，可單獨測試（比照 event-matching.ts）。
// 門檻數字來自 vault decisions/2026-08-04_奇策年度經營決策_顧問團診斷.md，
// 改門檻只改這裡的常數。

export interface DealLite {
  amount: number
  product: string
  delivery: string
  signedYm: string // 'YYYY-MM'（Asia/Taipei）
}

export interface PaymentLite {
  amount: number
  paidYm: string
}

// ── 決策檔門檻 ───────────────────────────────────────────────
export const MILESTONE_MONTHLY = 380_000 // 買車里程碑：月簽約金額
export const MILESTONE_STREAK = 3        // 連續達標月數
export const OUTSOURCE_MONTHLY = 2       // 請製作人力：每月外包溢出案數
export const OUTSOURCE_STREAK = 3
export const SEO_HIRE_COUNT = 7          // 請 SEO 執行：有效 SEO 年約家數
export const SEO_ACTIVE_MONTHS = 12      // 年約有效期（簽約後 12 個月內視為有效）

export interface MonthAgg {
  ym: string
  signedTotal: number
  signedCount: number
  paidTotal: number
  outsourceCount: number
}

export interface Progress {
  currentYm: string
  months: MonthAgg[] // 最近 6 個月，新到舊
  milestoneStreak: number // 不含本月的連續達標月數
  milestoneCurrentMet: boolean
  milestoneGap: number // 本月距離 38 萬還差多少（達標則 0）
  outsourceStreak: number
  outsourceCurrentMet: boolean
  seoActiveCount: number
}

export function taipeiYm(d: Date): string {
  // en-CA 產出 YYYY-MM-DD，取前 7 碼
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).slice(0, 7)
}

function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function lastMonths(currentYm: string, n: number): string[] {
  const out: string[] = [currentYm]
  while (out.length < n) out.push(prevYm(out[out.length - 1]))
  return out
}

/** 從當月往回數，連續滿足 met 條件的月數。skipCurrent 時本月不列入（月中未達標不應斷開紀錄）。 */
function streak(months: MonthAgg[], met: (m: MonthAgg) => boolean, skipCurrent: boolean): number {
  let count = 0
  for (let i = skipCurrent ? 1 : 0; i < months.length; i++) {
    if (met(months[i])) count++
    else break
  }
  return count
}

export function computeProgress(deals: DealLite[], payments: PaymentLite[], currentYm: string): Progress {
  const yms = lastMonths(currentYm, 6)
  const months: MonthAgg[] = yms.map(ym => {
    const d = deals.filter(x => x.signedYm === ym)
    const p = payments.filter(x => x.paidYm === ym)
    return {
      ym,
      signedTotal: d.reduce((s, x) => s + x.amount, 0),
      signedCount: d.length,
      paidTotal: p.reduce((s, x) => s + x.amount, 0),
      outsourceCount: d.filter(x => x.delivery === '外包').length,
    }
  })

  const cur = months[0]
  const milestoneCurrentMet = cur.signedTotal >= MILESTONE_MONTHLY
  const outsourceCurrentMet = cur.outsourceCount >= OUTSOURCE_MONTHLY

  // SEO 年約：簽約日在 12 個月內都算有效
  const activeWindow = lastMonths(currentYm, SEO_ACTIVE_MONTHS)
  const seoActiveCount = deals.filter(
    x => x.product === 'SEO年約' && activeWindow.includes(x.signedYm)
  ).length

  return {
    currentYm,
    months,
    milestoneStreak: streak(months, m => m.signedTotal >= MILESTONE_MONTHLY, !milestoneCurrentMet),
    milestoneCurrentMet,
    milestoneGap: Math.max(0, MILESTONE_MONTHLY - cur.signedTotal),
    outsourceStreak: streak(months, m => m.outsourceCount >= OUTSOURCE_MONTHLY, !outsourceCurrentMet),
    outsourceCurrentMet,
    seoActiveCount,
  }
}

function wan(n: number): string {
  const w = n / 10_000
  return Number.isInteger(w) ? `${w} 萬` : `${w.toFixed(1)} 萬`
}

/** 廣告時間軸提示（時間敏感，2026 下半年作戰計畫專用） */
export function adsStatusLine(now: Date): string {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  if (ymd < '2026-09-01') return `廣告：九月點火前置中，8/31 前官網落地頁＋追蹤要完成（今天 ${ymd}）`
  if (ymd < '2026-12-01') {
    const month = Number(ymd.slice(5, 7)) - 8 // 9月=第1月
    return `廣告：測試期第 ${month}/3 個月（月預算 3 萬）。停損規則：三個月成交 <2 案就停，≥3 案才加碼`
  }
  return '廣告：三個月測試期已結束，該做加碼或停止的結論了'
}

export function formatProgress(p: Progress, adsLine: string): string {
  const cur = p.months[0]
  const lines: string[] = []

  lines.push(`📊 業務戰情（${p.currentYm}）`)
  lines.push(`本月簽約 ${wan(cur.signedTotal)}（${cur.signedCount} 案）｜實收 ${wan(cur.paidTotal)}`)
  lines.push('')

  // 買車里程碑
  const mDone = p.milestoneStreak >= MILESTONE_STREAK
  if (mDone) {
    lines.push(`🚗 買車里程碑：達成！連續 ${p.milestoneStreak} 個月簽約破 38 萬，公司該買車給創辦人了`)
  } else {
    const monthWord = p.milestoneCurrentMet
      ? `本月已達標，連續 ${p.milestoneStreak}/${MILESTONE_STREAK} 個月`
      : `本月還差 ${wan(p.milestoneGap)}，目前連續 ${p.milestoneStreak}/${MILESTONE_STREAK} 個月`
    lines.push(`🚗 買車里程碑（月簽約 38 萬 × 連續 3 月）：${monthWord}`)
  }

  // 請製作人力
  const oDone = p.outsourceStreak >= OUTSOURCE_STREAK
  lines.push(
    oDone
      ? `👷 請製作人力：條件成立！外包溢出已連續 ${p.outsourceStreak} 個月 ≥2 案，自聘比外包划算了`
      : `👷 請製作人力（外包溢出 ≥2 案 × 連續 3 月）：本月外包 ${cur.outsourceCount} 案，連續 ${p.outsourceStreak}/${OUTSOURCE_STREAK} 個月`
  )

  // 請 SEO 執行
  lines.push(
    p.seoActiveCount >= SEO_HIRE_COUNT
      ? `📈 請 SEO 執行：條件成立！有效 SEO 年約 ${p.seoActiveCount} 家，自建交付比外包便宜了`
      : `📈 請 SEO 執行（年約 ≥7 家）：目前 ${p.seoActiveCount}/${SEO_HIRE_COUNT} 家`
  )

  lines.push(`💰 ${adsLine}`)

  // 近三個月趨勢
  const trend = p.months.slice(0, 3).map(m => `${m.ym.slice(5)}月 ${wan(m.signedTotal)}`).join('｜')
  lines.push('')
  lines.push(`近三月簽約：${trend}`)

  return lines.join('\n')
}
