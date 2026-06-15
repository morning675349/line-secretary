export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google-calendar'

export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get('userId')
  if (!lineUserId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  const url = getAuthUrl(lineUserId)
  return NextResponse.redirect(url)
}
