import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

/**
 * cron 與維運端點的共用驗證。
 *
 * 舊寫法是 `auth !== \`Bearer ${process.env.CRON_SECRET}\``，當環境變數遺失時
 * 字串會變成 "Bearer undefined"，攻擊者照打就能通過，屬於典型的 fail-open。
 * 這裡改成環境變數沒設就一律拒絕（fail closed），並用常數時間比對避免計時側錄。
 *
 * 回傳 null 代表通過，回傳 NextResponse 代表已被拒絕。
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set — refusing request (fail closed)')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 503 })
  }

  const header = req.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`

  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
