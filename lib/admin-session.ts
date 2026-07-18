// 後台登入 session 工具
// 設計目標：
// 1. cookie 內容絕不等於明文密碼本身（避免 cookie 外洩＝密碼外洩）
// 2. 簽章/比對使用 Web Crypto（Edge 與 Node runtime 皆可用，含 middleware）
// 3. session 有效期限（7 天），到期需重新輸入密碼

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 天

function toBase64Url(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

/** 產生登入成功後要放進 cookie 的 session token（不含明文密碼） */
export async function createSessionToken(): Promise<string> {
  const secret = process.env.ADMIN_PASSWORD || ''
  const enc = new TextEncoder()
  const exp = Date.now() + SESSION_TTL_MS
  const payloadBytes = enc.encode(String(exp))
  const key = await getHmacKey(secret)
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes))
  return `${toBase64Url(payloadBytes)}.${toBase64Url(sig)}`
}

/** 驗證 cookie 內的 session token 是否有效（簽章正確且未過期） */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false
  const secret = process.env.ADMIN_PASSWORD
  if (!secret) return false

  const parts = token.split('.')
  if (parts.length !== 2) return false

  try {
    const payloadBytes = fromBase64Url(parts[0])
    const sigBytes = fromBase64Url(parts[1])
    const key = await getHmacKey(secret)
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes as BufferSource, payloadBytes as BufferSource)
    if (!valid) return false

    const exp = Number(new TextDecoder().decode(payloadBytes))
    if (!Number.isFinite(exp) || Date.now() > exp) return false

    return true
  } catch {
    return false
  }
}

/** 常數時間比對密碼，避免逐字元比對造成的計時側錄攻擊 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const bytesA = new Uint8Array(digestA)
  const bytesB = new Uint8Array(digestB)
  let diff = 0
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i]
  return diff === 0
}

/**
 * 極簡登入嘗試限流（記憶體內、單一 serverless instance 有效）。
 * 目的是提高暴力破解成本，非取代正式的 WAF / rate limit 服務。
 * 建議另外在 Vercel Firewall 設定正式的 rate limit 規則（見審查報告）。
 */
const attempts = new Map<string, { count: number; firstAttemptAt: number }>()
const MAX_ATTEMPTS = 8
const WINDOW_MS = 5 * 60 * 1000 // 5 分鐘

export function isRateLimited(key: string): boolean {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry) return false
  if (now - entry.firstAttemptAt > WINDOW_MS) {
    attempts.delete(key)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now - entry.firstAttemptAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAttemptAt: now })
    return
  }
  entry.count += 1
}

export function clearAttempts(key: string): void {
  attempts.delete(key)
}
