'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    setLoading(false)
    if (res.ok) {
      router.push('/admin/contacts')
    } else {
      setError('密碼錯誤')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a1f2e', borderRadius: 16, padding: '48px 40px', width: 360, boxShadow: '0 4px 32px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🤖</div>
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: 0 }}>安安特助後台</h1>
          <p style={{ color: '#666', fontSize: 13, marginTop: 6 }}>請輸入後台密碼</p>
        </div>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            placeholder="密碼"
            value={pw}
            onChange={e => setPw(e.target.value)}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 8, border: '1px solid #2a3050',
              background: '#0f1117', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
            }}
            autoFocus
          />
          {error && <p style={{ color: '#e74c3c', fontSize: 13, margin: '0 0 12px' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, border: 'none',
              background: '#27ae60', color: '#fff', fontSize: 15, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '登入中...' : '進入後台'}
          </button>
        </form>
      </div>
    </div>
  )
}
