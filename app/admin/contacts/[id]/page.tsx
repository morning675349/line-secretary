'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

const STATUSES = ['待跟進', '已聯絡', '已提案', '成交', '引薦完成']
const CATEGORIES = ['潛在客戶', 'BNI夥伴', 'DobBiz用戶', '引薦來源', '待觀察']

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#9ba3c2', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #2a3050',
  background: '#0f1117', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer',
}

export default function ContactDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const [contact, setContact] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/contacts/${id}`)
      .then(r => { if (r.status === 401) { router.push('/admin/login'); throw new Error() } return r.json() })
      .then(data => { setContact(data); setForm(data) })
      .catch(() => {})
  }, [id, router])

  function update(key: string, value: any) {
    setForm((prev: any) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch(`/api/admin/contacts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleDelete() {
    if (!confirm('確定要刪除這筆聯絡人嗎？')) return
    setDeleting(true)
    await fetch(`/api/admin/contacts/${id}`, { method: 'DELETE' })
    router.push('/admin/contacts')
  }

  async function addNote() {
    if (!newNote.trim()) return
    await fetch(`/api/admin/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: newNote.trim() }),
    })
    setNewNote('')
    const r = await fetch(`/api/admin/contacts/${id}`)
    const data = await r.json()
    setContact(data)
    setForm(data)
  }

  if (!contact) return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
      載入中...
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2a3050', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => router.push('/admin/contacts')}
          style={{ background: 'none', border: 'none', color: '#9ba3c2', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>←</button>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{contact.nameZh || contact.nameEn || '聯絡人詳情'}</span>
        <span style={{ color: '#666', fontSize: 13 }}>{contact.company}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ background: saved ? '#1a6b3e' : '#27ae60', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? '儲存中...' : saved ? '✅ 已儲存' : '儲存'}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            style={{ background: 'transparent', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            {deleting ? '刪除中...' : '刪除'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* 基本資訊 */}
        <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 20 }}>
          <h3 style={{ color: '#9ba3c2', fontSize: 12, fontWeight: 500, marginBottom: 16, letterSpacing: 1 }}>基本資訊</h3>
          <Field label="中文姓名">
            <input style={inputStyle} value={form.nameZh || ''} onChange={e => update('nameZh', e.target.value)} />
          </Field>
          <Field label="英文姓名">
            <input style={inputStyle} value={form.nameEn || ''} onChange={e => update('nameEn', e.target.value)} />
          </Field>
          <Field label="公司">
            <input style={inputStyle} value={form.company || ''} onChange={e => update('company', e.target.value)} />
          </Field>
          <Field label="英文公司">
            <input style={inputStyle} value={form.companyEn || ''} onChange={e => update('companyEn', e.target.value)} />
          </Field>
          <Field label="職稱">
            <input style={inputStyle} value={form.title || ''} onChange={e => update('title', e.target.value)} />
          </Field>
          <Field label="手機">
            <input style={inputStyle} value={form.mobile || ''} onChange={e => update('mobile', e.target.value)} />
          </Field>
          <Field label="辦公電話">
            <input style={inputStyle} value={form.officePhone || ''} onChange={e => update('officePhone', e.target.value)} />
          </Field>
          <Field label="Email">
            <input style={inputStyle} value={form.email || ''} onChange={e => update('email', e.target.value)} />
          </Field>
          <Field label="網站">
            <input style={inputStyle} value={form.website || ''} onChange={e => update('website', e.target.value)} />
          </Field>
          <Field label="地址">
            <input style={inputStyle} value={form.address || ''} onChange={e => update('address', e.target.value)} />
          </Field>
        </div>

        {/* 右欄 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* CRM 資訊 */}
          <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: '#9ba3c2', fontSize: 12, fontWeight: 500, marginBottom: 16, letterSpacing: 1 }}>CRM 評估</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="評分（1-10）">
                <input style={inputStyle} type="number" min="1" max="10" value={form.score ?? ''} onChange={e => update('score', Number(e.target.value))} />
              </Field>
              <Field label="跟進天數">
                <input style={inputStyle} type="number" value={form.followUpDays ?? ''} onChange={e => update('followUpDays', Number(e.target.value))} />
              </Field>
            </div>
            <Field label="分類">
              <select style={selectStyle} value={form.category || ''} onChange={e => update('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="狀態">
              <select style={selectStyle} value={form.status || '待跟進'} onChange={e => update('status', e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="場合">
              <input style={inputStyle} value={form.source || ''} onChange={e => update('source', e.target.value)} />
            </Field>
            <Field label="產業">
              <input style={inputStyle} value={form.industry || ''} onChange={e => update('industry', e.target.value)} />
            </Field>
            <Field label="服務項目（逗號分隔）">
              <input style={inputStyle}
                value={(form.services || []).join('、')}
                onChange={e => update('services', e.target.value.split(/[、,，]/).map((s: string) => s.trim()).filter(Boolean))} />
            </Field>
            <Field label="跟進建議">
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                value={form.followUpSuggestion || ''} onChange={e => update('followUpSuggestion', e.target.value)} />
            </Field>
            <Field label="DobBiz 潛力">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form.isDobBizPotential} onChange={e => update('isDobBizPotential', e.target.checked)} />
                <span style={{ fontSize: 13, color: '#9ba3c2' }}>{form.isDobBizPotential ? '是，此聯絡人有 DobBiz 潛力' : '否'}</span>
              </label>
            </Field>
            {form.isDobBizPotential && (
              <Field label="DobBiz 備註">
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                  value={form.dobBizNote || ''} onChange={e => update('dobBizNote', e.target.value)} />
              </Field>
            )}
          </div>

          {/* 備註 */}
          <div style={{ background: '#1a1f2e', borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: '#9ba3c2', fontSize: 12, fontWeight: 500, marginBottom: 16, letterSpacing: 1 }}>備註歷史</h3>
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
              {(contact.notes || []).length === 0 ? (
                <p style={{ color: '#666', fontSize: 13 }}>尚無備註</p>
              ) : [...(contact.notes || [])].reverse().map((note: string, i: number) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #2a3050', fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                  {note}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="新增備註..."
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addNote()}
              />
              <button onClick={addNote}
                style={{ background: '#3498db', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>
                新增
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
