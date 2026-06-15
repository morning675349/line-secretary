import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

function initApp() {
  if (!getApps().length) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ?.replace(/\\n/g, '\n')
      .replace(/^"|"$/g, '')

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    })
  }
}

export const db = {
  collection: (name: string) => {
    initApp()
    return getFirestore().collection(name)
  },
}

export function getBucket() {
  initApp()
  return getStorage().bucket()
}
