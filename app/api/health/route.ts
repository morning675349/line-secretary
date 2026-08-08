export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron-auth'
import { verifyLineToken } from '@/lib/line-client'
import { db } from '@/lib/firebase-admin'
import { openai, AGENT_MODEL } from '@/lib/ai'

/**
 * 依賴健康檢查。
 *
 * 2026-07-27 LINE access token 失效，整個特助對外靜默，但站台、webhook、
 * agent 全都「正常」，只有真的去問 LINE 官方 API 才看得出來。
 * 這支端點把那次的排查過程固化下來，之後一次 curl 就知道斷在哪。
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  const checks: Record<string, { ok: boolean; detail: string }> = {}

  const requiredEnv = [
    'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'OPENAI_API_KEY',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
    'ADMIN_PASSWORD', 'CRON_SECRET',
  ]
  const missing = requiredEnv.filter(k => !process.env[k])
  checks.env = {
    ok: missing.length === 0,
    detail: missing.length ? `缺少：${missing.join(', ')}` : `${requiredEnv.length} 項環境變數齊全`,
  }

  checks.line = await (async () => {
    const r = await verifyLineToken()
    return {
      ok: r.ok,
      detail: r.ok ? 'access token 有效' : `HTTP ${r.status} ${r.detail}`,
    }
  })()

  checks.firestore = await (async () => {
    try {
      const snap = await db.collection('users').limit(1).get()
      return { ok: true, detail: `連線正常，users 集合可讀（${snap.size} 筆樣本）` }
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 200) }
    }
  })()

  checks.openai = await (async () => {
    try {
      const r = await openai.chat.completions.create({
        model: AGENT_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_completion_tokens: 16,
      })
      return { ok: true, detail: `${r.model} 可用` }
    } catch (err) {
      return { ok: false, detail: String(err).slice(0, 200) }
    }
  })()

  const allOk = Object.values(checks).every(c => c.ok)
  return NextResponse.json(
    { ok: allOk, checkedAt: new Date().toISOString(), checks },
    { status: allOk ? 200 : 503 }
  )
}
