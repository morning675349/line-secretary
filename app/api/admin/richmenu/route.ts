export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/admin-session'
import { setupRichMenu, RICH_MENU } from '@/lib/richmenu'

// 圖文選單上架。走後台密碼驗證（middleware 已保護 /api/admin/*，這裡再驗一次做縱深防禦）。
// 底圖放在 public/richmenu.png，由 Vercel 靜態託管，這裡用 HTTP 抓回來再轉送給 LINE：
// serverless 函式不保證能用 fs 讀到 public/ 的檔案，走 HTTP 最穩。

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const ok = await verifySessionToken(req.cookies.get('admin_token')?.value)
  return ok ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  return NextResponse.json({
    name: RICH_MENU.name,
    chatBarText: RICH_MENU.chatBarText,
    buttons: RICH_MENU.areas.map(a => ({ label: a.action.label, action: a.action.type })),
    hint: '用 POST 這支端點即可重新上架選單',
  })
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.get('host')}`

  try {
    const imgRes = await fetch(`${baseUrl}/richmenu.png`, { cache: 'no-store' })
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: `抓不到底圖 ${baseUrl}/richmenu.png（HTTP ${imgRes.status}）` },
        { status: 502 }
      )
    }
    const image = Buffer.from(await imgRes.arrayBuffer())

    const result = await setupRichMenu(image)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('Rich menu setup failed:', err)
    return NextResponse.json({ error: String(err).slice(0, 500) }, { status: 500 })
  }
}
