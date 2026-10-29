export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { QueryDocumentSnapshot } from 'firebase-admin/firestore'

/**
 * 讀最近的錯誤紀錄。權限由 middleware 的 /api/admin/:path* 統一擋。
 *
 * 刻意不用 orderBy：這個專案的慣例是不建複合索引，全撈進記憶體再排序。
 * 錯誤紀錄只留 14 天，量很小。
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 20), 100)
  const snap = await db.collection('error_logs').get()
  const rows = snap.docs
    .map((d: QueryDocumentSnapshot) => {
      const v = d.data()
      return {
        id: d.id,
        where: v.where || '',
        message: v.message || '',
        stack: v.stack || '',
        extra: v.extra || {},
        at: v.createdAt?.toDate?.()?.toISOString() || '',
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)

  return NextResponse.json({ count: snap.size, rows })
}
