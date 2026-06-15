import sharp from 'sharp'
import { getBucket } from './firebase-admin'

export async function uploadCardImage(buffer: Buffer, contactId: string): Promise<string> {
  const compressed = await sharp(buffer)
    .resize(1600, null, { withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true })
    .toBuffer()

  const bucket = getBucket()
  const filename = `cards/${contactId}.jpg`
  const file = bucket.file(filename)

  await file.save(compressed, {
    contentType: 'image/jpeg',
    metadata: { cacheControl: 'public, max-age=31536000' },
    public: true,
  })

  return `https://storage.googleapis.com/${process.env.FIREBASE_STORAGE_BUCKET}/${filename}`
}
