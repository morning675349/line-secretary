export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firebase-admin'
import { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import * as XLSX from 'xlsx'

function checkAuth(req: NextRequest) {
  const cookie = req.cookies.get('admin_token')?.value
  return cookie === process.env.ADMIN_PASSWORD
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') || ''
  const status = searchParams.get('status') || ''
  const category = searchParams.get('category') || ''
  const source = searchParams.get('source') || ''
  const dobBiz = searchParams.get('dobBiz') === 'true'
  const exportExcel = searchParams.get('export') === 'excel'

  const snap = await db.collection('contacts').get()
  let contacts = snap.docs.map((d: QueryDocumentSnapshot) => {
    const data = d.data()
    return {
      id: d.id,
      ...data,
      followUpAt: data.followUpAt?.toDate?.()?.toISOString() ?? null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    }
  })

  if (q) {
    const ql = q.toLowerCase()
    contacts = contacts.filter((c: any) =>
      c.nameZh?.toLowerCase().includes(ql) ||
      c.nameEn?.toLowerCase().includes(ql) ||
      c.company?.toLowerCase().includes(ql) ||
      c.title?.toLowerCase().includes(ql) ||
      c.mobile?.includes(ql) ||
      c.email?.toLowerCase().includes(ql) ||
      c.industry?.toLowerCase().includes(ql)
    )
  }
  if (status) contacts = contacts.filter((c: any) => c.status === status)
  if (category) contacts = contacts.filter((c: any) => c.category === category)
  if (source) contacts = contacts.filter((c: any) => c.source === source)
  if (dobBiz) contacts = contacts.filter((c: any) => c.isDobBizPotential)

  contacts.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))

  if (exportExcel) {
    const rows = contacts.map((c: any) => ({
      姓名: c.nameZh || c.nameEn || '',
      英文名: c.nameEn || '',
      公司: c.company || '',
      英文公司: c.companyEn || '',
      職稱: c.title || '',
      手機: c.mobile || '',
      辦公電話: c.officePhone || '',
      Email: c.email || '',
      網站: c.website || '',
      地址: c.address || '',
      產業: c.industry || '',
      服務項目: (c.services || []).join('、'),
      評分: c.score ?? '',
      分類: c.category || '',
      狀態: c.status || '',
      場合: c.source || '',
      DobBiz潛力: c.isDobBizPotential ? '是' : '否',
      DobBiz備註: c.dobBizNote || '',
      跟進建議: c.followUpSuggestion || '',
      跟進日期: c.followUpAt ? new Date(c.followUpAt).toLocaleDateString('zh-TW') : '',
      備註: (c.notes || []).join('\n'),
      建立時間: c.createdAt ? new Date(c.createdAt).toLocaleDateString('zh-TW') : '',
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 25 }, { wch: 30 },
      { wch: 15 }, { wch: 30 }, { wch: 6 }, { wch: 10 }, { wch: 10 },
      { wch: 15 }, { wch: 8 }, { wch: 25 }, { wch: 30 }, { wch: 12 },
      { wch: 40 }, { wch: 12 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, '聯絡人')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="contacts_${Date.now()}.xlsx"`,
      },
    })
  }

  return NextResponse.json({ contacts, total: contacts.length })
}
