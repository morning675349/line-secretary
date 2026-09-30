import { randomUUID } from 'crypto'
import { getBucket } from './firebase-admin'

export async function uploadCardImage(buffer: Buffer, contactId: string): Promise<string> {
  const bucket = getBucket()
  const filename = `cards/${contactId}.jpg`
  const file = bucket.file(filename)

  await file.save(buffer, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000' },
    public: true,
  })

  return `https://storage.googleapis.com/${process.env.FIREBASE_STORAGE_BUCKET}/${filename}`
}

// 匯出名單的存放期限。名單含聯絡人手機與 Email，
// 不能像名片圖那樣設成永久公開，改用有時效的簽章網址。
const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 上傳匯出的 CSV，回傳 7 天後失效的簽章網址。
 * 檔名帶隨機碼，避免有人猜路徑撈別人的名單。
 */
export async function uploadExportCsv(content: string, label: string): Promise<{ url: string; expiresAt: Date }> {
  const bucket = getBucket()
  const rand = randomUUID().slice(0, 8)
  const safeLabel = label.replace(/[^\w一-龥-]/g, '_').slice(0, 40)
  const filename = `exports/${Date.now()}-${rand}-${safeLabel}.csv`
  const file = bucket.file(filename)

  await file.save(Buffer.from(content, 'utf8'), {
    contentType: 'text/csv; charset=utf-8',
    metadata: { cacheControl: 'private, max-age=0' },
  })

  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS)
  const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAt })
  return { url, expiresAt }
}
