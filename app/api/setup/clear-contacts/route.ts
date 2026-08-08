export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { requireCronAuth } from '@/lib/cron-auth'

// 破壞性端點：會刪光整個 contacts 集合。除了 cron 驗證外，再要求帶上
// ?confirm=DELETE_ALL_CONTACTS，避免手滑或誤觸就把人脈庫清空。
export async function DELETE(req: NextRequest) {
  const denied = requireCronAuth(req)
  if (denied) return denied

  if (req.nextUrl.searchParams.get('confirm') !== 'DELETE_ALL_CONTACTS') {
    return NextResponse.json(
      { error: 'Missing confirmation. Append ?confirm=DELETE_ALL_CONTACTS to proceed.' },
      { status: 400 }
    )
  }

  const snap = await db.collection('contacts').get()
  const batch = db.collection('contacts').firestore.batch()
  snap.docs.forEach(doc => batch.delete(doc.ref))
  await batch.commit()

  return NextResponse.json({ ok: true, deleted: snap.size })
}
