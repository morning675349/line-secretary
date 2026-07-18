export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { saveTokens, consumeOAuthState } from '@/lib/google-calendar'
import { pushMessage } from '@/lib/line-client'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  if (!code || !state) {
    return new NextResponse('授權失敗，缺少必要參數', { status: 400 })
  }

  const lineUserId = await consumeOAuthState(state)
  if (!lineUserId) {
    return new NextResponse('授權連結已失效或過期，請回到 LINE 重新產生連結', { status: 400 })
  }

  try {
    await saveTokens(lineUserId, code)
    await pushMessage(lineUserId, '✅ Google Calendar 已成功連結！\n\n現在你可以：\n「排程 下週三下午3點跟王總開會」\n→ 自動建立行程')
    return new NextResponse('<html><body><h2>✅ 授權成功！請回到 LINE 繼續使用。</h2></body></html>', {
      headers: { 'Content-Type': 'text/html' },
    })
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    return new NextResponse('授權失敗，請重試', { status: 500 })
  }
}
