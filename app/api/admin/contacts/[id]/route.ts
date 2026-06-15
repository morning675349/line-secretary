export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

function checkAuth(req: NextRequest) {
  return req.cookies.get('admin_token')?.value === process.env.ADMIN_PASSWORD
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const doc = await db.collection('contacts').doc(id).get()
  if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const data = doc.data()!
  return NextResponse.json({
    id: doc.id,
    ...data,
    followUpAt: data.followUpAt?.toDate?.()?.toISOString() ?? null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()

  const allowed = [
    'nameZh', 'nameEn', 'company', 'companyEn', 'title', 'titleEn',
    'mobile', 'officePhone', 'fax', 'email', 'address', 'website',
    'services', 'industry', 'companySize', 'score', 'category',
    'isDobBizPotential', 'dobBizNote', 'followUpDays', 'followUpSuggestion',
    'status', 'source', 'reasoning',
  ]
  const updates: Record<string, any> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (body.followUpAt) {
    updates.followUpAt = new Date(body.followUpAt)
  }

  await db.collection('contacts').doc(id).update(updates)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await db.collection('contacts').doc(id).delete()
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { note } = await req.json()
  const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  await db.collection('contacts').doc(id).update({
    notes: FieldValue.arrayUnion(`[${ts}] ${note}`),
  })
  return NextResponse.json({ ok: true })
}
