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
