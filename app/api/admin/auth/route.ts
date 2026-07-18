export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, constantTimeEqual, isRateLimited, recordFailedAttempt, clearAttempts } from '@/lib/admin-session'

function getClientKey(req: NextRequest): string {
  // Vercel 會附上 x-forwarded-for，取第一段作為限流 key
  const fwd = req.headers.get('x-forwarded-for')
  return fwd?.split(',')[0].trim() || 'unknown'
}

export async function POST(req: NextRequest) {
  const clientKey = getClientKey(req)

  if (isRateLimited(clientKey)) {
    return NextResponse.json({ error: '嘗試次數過多，請稍後再試' }, { status: 429 })
  }

  const { password } = await req.json()
  const adminPassword = process.env.ADMIN_PASSWORD || ''
  const ok = adminPassword.length > 0 && (await constantTimeEqual(password || '', adminPassword))

  if (!ok) {
    recordFailedAttempt(clientKey)
    return NextResponse.json({ error: '密碼錯誤' }, { status: 401 })
  }

  clearAttempts(clientKey)
  const token = await createSessionToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('admin_token')
  return res
}
