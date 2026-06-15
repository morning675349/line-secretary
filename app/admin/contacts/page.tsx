'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const STATUS_OPTS = ['全部', '待跟進', '已聯絡', '已提案', '成交', '引薦完成']
const CATEGORY_OPTS = ['全部', '潛在客戶', 'BNI夥伴', 'DobBiz用戶', '引薦來源', '待觀察']
const SCORE_COLOR = (s: number) => s >= 8 ? '#27ae60' : s >= 6 ? '#e67e22' : '#7f8c8d'
const STATUS_COLOR: Record<string, string> = {
  '待跟進': '#e67e22', '已聯絡': '#3498db', '已提案': '#9b59b6', '成交': '#27ae60', '引薦完成': '#1abc9c',
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('全部')
  const [category, setCategory] = useState('全部')
  const [dobBiz, setDobBiz] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (status !== '全部') params.set('status', status)
    if (category !== '全部') params.set('category', category)
    if (dobBiz) params.set('dobBiz', 'true')
    const res = await fetch(`/api/admin/contacts?${params}`)
    if (res.status === 401) { router.push('/admin/login'); return }
    const data = await res.json()
    setContacts(data.contacts || [])
    setTotal(data.total || 0)
    setLoading(false)
  }, [q, status, category, dobBiz, router])

  useEffect(() => {
    const t = setTimeout(fetchContacts, 300)
    return () => clearTimeout(t)
  }, [fetchContacts])

  async function handleExport() {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (status !== '全部') params.set('status', status)
    if (category !== '全部') params.set('category', category)
    if (dobBiz) params.set('dobBiz', 'true')
    params.set('export', 'excel')
    const res = await fetch(`/api/admin/contacts?${params}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `聯絡人_${new Date().toLocaleDateString('zh-TW').replace(/\//g, '')}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3050', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>安安特助後台</span>
          <span style={{ background: '#2a3050', borderRadius: 20, padding: '3px 12px', fontSize: 12, color: '#9ba3c2' }}>
            共 {total} 筆聯絡人
          </span>
        </div>
        <button
          onClick={handleExport}
          style={{ background: '#27ae60', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
        >
          ⬇ 匯出 Excel
        </button>
      </div>

      <div style={{ padding: '20px 24px' }}>
        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            placeholder="🔍 搜尋姓名、公司、手機..."
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{
              flex: 1, minWidth: 200, padding: '10px 16px', borderRadius: 8,
              border: '1px solid #2a3050', background: '#1a1f2e', color: '#fff', fontSize: 14, outline: 'none',
            }}
          />
          <select value={status} onChange={e => setStatus(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #2a3050', background: '#1a1f2e', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
            {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value)}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #2a3050', background: '#1a1f2e', color: '#fff', fontSize: 14, cursor: 'pointer' }}>
            {CATEGORY_OPTS.map(c => <option key={c}>{c}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer', color: '#9ba3c2' }}>
            <input type="checkbox" checked={dobBiz} onChange={e => setDobBiz(e.target.checked)} />
            DobBiz 潛力
          </label>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>載入中...</div>
        ) : contacts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#666' }}>沒有符合的聯絡人</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a3050', color: '#9ba3c2' }}>
                  {['姓名', '公司', '職稱', '手機', '評分', '分類', '狀態', '場合', '跟進日'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contacts.map((c: any) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/admin/contacts/${c.id}`)}
                    style={{ borderBottom: '1px solid #1a1f2e', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1a1f2e')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                      {c.nameZh || c.nameEn || '—'}
                      {c.isDobBizPotential && <span style={{ marginLeft: 6, fontSize: 10, background: '#1e6b3e', color: '#27ae60', borderRadius: 4, padding: '2px 5px' }}>D</span>}
                    </td>
                    <td style={{ padding: '10px 12px', color: '#ccc' }}>{c.company || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#999' }}>{c.title || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#999' }}>{c.mobile || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ color: SCORE_COLOR(c.score), fontWeight: 600 }}>{c.score ?? '—'}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#9ba3c2' }}>{c.category || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: STATUS_COLOR[c.status] + '22', color: STATUS_COLOR[c.status], borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#999' }}>{c.source || '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#999', whiteSpace: 'nowrap' }}>
                      {c.followUpAt ? new Date(c.followUpAt).toLocaleDateString('zh-TW') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
