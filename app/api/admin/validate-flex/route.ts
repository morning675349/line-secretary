export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { scanResultMessage, contactCarousel } from '@/lib/flex'
import type { ScanCardData, ContactCardData } from '@/lib/flex'

/**
 * 用 LINE 官方的「驗證但不送出」端點檢查我們組出來的 Flex 訊息。
 *
 * 由來：2026-10-29 掃名片回「發生錯誤」。新的結果卡片只做過 JSON 結構的
 * 單元測試，從來沒讓 LINE 真的收過。單元測試驗得了形狀，驗不了 LINE 的規格。
 *
 * 之後只要改過 Flex 卡片，部署完一定要先打這支確認，不要等使用者踩到。
 */
const LINE_API = 'https://api.line.me/v2/bot'

async function validate(label: string, message: unknown) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { label, ok: false, detail: '缺少 LINE_CHANNEL_ACCESS_TOKEN' }

  const res = await fetch(`${LINE_API}/message/validate/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [message] }),
  })
  const body = await res.text()
  return { label, ok: res.ok, status: res.status, detail: res.ok ? '通過' : body.slice(0, 600) }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams

  // 全部用中性假資料，不帶入任何真實聯絡人內容
  const sample: ScanCardData = {
    contactId: 'testcontact1',
    imageUrl: q.get('imageUrl') ?? `https://storage.googleapis.com/${process.env.FIREBASE_STORAGE_BUCKET}/cards/sample.jpg`,
    name: '測試姓名',
    company: '測試股份有限公司',
    title: '測試職稱',
    mobile: q.get('mobile') ?? '0900-000000',
    email: 'test@example.com',
    source: q.get('source') ?? '',
    score: 8,
    category: '潛在客戶',
    followUpDate: '11/1',
    uncertainLabels: (q.get('uncertain') ?? '中文姓名').split(',').filter(Boolean),
    expoIndex: Number(q.get('expoIndex') || 0),
  }

  const contactSample: ContactCardData = {
    contactId: 'testcontact1', name: '測試姓名', company: '測試股份有限公司',
    title: '測試職稱', score: 8, category: '潛在客戶', status: '待跟進',
    source: '測試場合', lastNote: '測試筆記', mobile: '0900-000000', officePhone: '',
  }

  // 逐項拆解，才分得出是整張卡片有問題還是某個區塊有問題
  const checks = await Promise.all([
    validate('掃描卡片（完整）', scanResultMessage(sample)),
    validate('掃描卡片（無縮圖）', scanResultMessage({ ...sample, imageUrl: '' })),
    validate('掃描卡片（無電話）', scanResultMessage({ ...sample, mobile: '' })),
    validate('掃描卡片（展場模式）', scanResultMessage({ ...sample, expoIndex: 3 })),
    validate('掃描卡片（無不確定欄位）', scanResultMessage({ ...sample, uncertainLabels: [] })),
    validate('掃描卡片（有場合）', scanResultMessage({ ...sample, source: '測試場合' })),
    validate('聯絡人卡片（既有功能，對照組）', contactCarousel([contactSample])),
  ])

  // 探針：確認 Flex 按鈕的 action 到底吃不吃 inputOption／fillInText。
  // LINE 一則訊息只回報第一個錯誤，所以要一個屬性一張卡片單獨問，才分得出來。
  // 這也決定「📍 改場合」能不能把鍵盤預填「場合名稱：」救回來。
  const probeBubble = (action: Record<string, unknown>) => ({
    type: 'flex',
    altText: '探針',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical',
              contents: [{ type: 'text', text: '探針' }] },
      footer: { type: 'box', layout: 'vertical',
                contents: [{ type: 'button', style: 'link', height: 'sm', action }] },
    },
  })

  const probes = await Promise.all([
    validate('探針A：postback 不帶任何額外屬性',
      probeBubble({ type: 'postback', label: '測試', data: 'probe' })),
    validate('探針B：postback + openKeyboard + fillInText',
      probeBubble({ type: 'postback', label: '測試', data: 'probe',
                    inputOption: 'openKeyboard', fillInText: '場合名稱：' })),
    validate('探針C：postback + closeRichMenu（LINE 文件列的合法值）',
      probeBubble({ type: 'postback', label: '測試', data: 'probe',
                    inputOption: 'closeRichMenu' })),
  ])
  checks.push(...probes)

  const failed = checks.filter(c => !c.ok)

  // 回傳線上跑的是哪個 commit。
  //
  // 2026-10-29 這個問題害我誤判兩次：先用 HTTP 401 當「新端點已上線」的訊號
  // （中介層對 /api/admin 底下不存在的路徑也回 401），後來又發現兩個版本的
  // 驗證結果會長得一模一樣，分不出讀到新版還是舊版。
  // Next 16 的靜態路徑固定是 immutable，沒有 per-build ID 可用，
  // 但 Vercel 會自動注入 VERCEL_GIT_COMMIT_SHA，直接回傳最省事。
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7)

  return NextResponse.json(
    { ok: failed.length === 0, commit, failedCount: failed.length, checks },
    { status: failed.length === 0 ? 200 : 422 }
  )
}
