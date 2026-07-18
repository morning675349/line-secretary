import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/admin-session'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isAdminPage = pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')
  // /api/admin/auth 本身就是登入／登出端點，不能要求先持有有效 token
  const isAdminApi = pathname.startsWith('/api/admin') && !pathname.startsWith('/api/admin/auth')

  if (isAdminPage || isAdminApi) {
    const token = req.cookies.get('admin_token')?.value
    const valid = await verifySessionToken(token)
    if (!valid) {
      if (isAdminApi) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
  }

  return NextResponse.next()
}

// 集中保護所有後台頁面與後台 API，避免個別路由漏掉權限檢查
export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] }
