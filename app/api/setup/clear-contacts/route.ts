export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'

export async function DELETE(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const snap = await db.collection('contacts').get()
  const batch = db.collection('contacts').firestore.batch()
  snap.docs.forEach(doc => batch.delete(doc.ref))
  await batch.commit()

  return NextResponse.json({ ok: true, deleted: snap.size })
}
