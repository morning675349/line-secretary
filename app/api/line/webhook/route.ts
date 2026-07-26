export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  downloadLineImage, replyMessage, pushMessage,
  pushSourceQuickReply, pushAnalysisWithCorrect,
} from '@/lib/line-client'
import { analyzeCard, formatCardReply } from '@/lib/card-analyzer'
import { uploadCardImage } from '@/lib/storage'
import { db } from '@/lib/firebase-admin'
import {
  saveContact, updateContactSource, updateContactField, addContactNote,
  setPendingSource, consumePendingSource, getLatestContact,
  setPendingNote, consumePendingNote,
  setPendingCorrection, consumePendingCorrection,
} from '@/lib/contact-service'
import { runAgent } from '@/lib/agent'
import { transcribeAudio } from '@/lib/transcribe'
import { appendSystemNote } from '@/lib/conversation'

// 使用者白名單：agent 每句話都有 API 成本，單人系統不開放陌生人使用。
// ALLOWED_LINE_USER_IDS 未設定時放行所有人（向下相容），設定後（逗號分隔）僅白名單可用。
function isAllowedUser(lineUserId: string | undefined): boolean {
  const allow = (process.env.ALLOWED_LINE_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (allow.length === 0) return true
  return !!lineUserId && allow.includes(lineUserId)
}

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET || ''
  const hash = crypto.createHmac('sha256', secret).update(body).digest()
  let sigBuf: Buffer
  try {
    sigBuf = Buffer.from(signature, 'base64')
  } catch {
    return false
  }
  if (sigBuf.length !== hash.length) return false
  return crypto.timingSafeEqual(hash, sigBuf)
}

// 回覆優先用 replyToken（不佔推播額度），agent 跑太久 token 過期就改用 push
async function replyOrPush(replyToken: string, lineUserId: string, text: string) {
  try {
    if (replyToken) {
      await replyMessage(replyToken, text)
      return
    }
  } catch (err) {
    console.error('Reply failed, falling back to push:', err)
  }
  await pushMessage(lineUserId, text)
}

// ── 名片掃描（單張）────────────────────────────────────────
async function handleImageMessage(messageId: string, replyToken: string, lineUserId: string) {
  await replyMessage(replyToken, '📷 收到名片，分析中...')

  const imageBuffer = await downloadLineImage(messageId)
  const card = await analyzeCard(imageBuffer)

  const followUpDate = new Date()
  followUpDate.setDate(followUpDate.getDate() + card.followUpDays)

  const contactId = await saveContact(lineUserId, card)

  uploadCardImage(imageBuffer, contactId)
    .then(url => db.collection('contacts').doc(contactId).update({ cardImageUrl: url }))
    .catch(err => console.error('Card image upload failed:', err))

  await pushAnalysisWithCorrect(lineUserId, formatCardReply(card, followUpDate), contactId)
  await pushSourceQuickReply(lineUserId, contactId)

  // 讓 agent 的對話記憶知道剛掃了誰，之後「他的電話多少？」接得上
  const displayName = card.nameZh || card.nameEn || '未知'
  appendSystemNote(lineUserId, `剛掃描了一張名片並建檔：${displayName}（${card.company}）`)
    .catch(err => console.error('Conversation note failed:', err))

  if (!card.services || card.services.length === 0) {
    await setPendingNote(lineUserId, contactId)
    await pushMessage(lineUserId, `🤔 ${displayName} 的名片沒有服務項目資訊\n你知道他們主要做什麼嗎？直接回覆我，我幫你存進去。`)
  }
}

// ── 名片掃描（批次，依序處理）──────────────────────────────
async function handleBatchImages(events: { messageId: string; replyToken: string }[], lineUserId: string) {
  if (events[0].replyToken) {
    await replyMessage(events[0].replyToken, `📷 收到 ${events.length} 張名片，依序分析中（請稍候）...`)
  }

  type ScanResult = { card: Awaited<ReturnType<typeof analyzeCard>>; contactId: string }
  const successful: ScanResult[] = []
  let failedCount = 0

  // 依序處理，避免同時呼叫 API 影響辨識品質
  for (const { messageId } of events) {
    try {
      const imageBuffer = await downloadLineImage(messageId)
      const card = await analyzeCard(imageBuffer)
      const contactId = await saveContact(lineUserId, card)
      uploadCardImage(imageBuffer, contactId)
        .then(url => db.collection('contacts').doc(contactId).update({ cardImageUrl: url }))
        .catch(err => console.error('Card image upload failed:', err))
      successful.push({ card, contactId })
    } catch (err) {
      console.error('Card scan failed:', err)
      failedCount++
    }
  }

  const lines = [
    `✅ 批次掃描完成！共 ${successful.length} 張名片`,
    ...(failedCount > 0 ? [`⚠️ ${failedCount} 張分析失敗`] : []),
    '',
    ...successful.map(({ card }, i) => {
      const name = card.nameZh || card.nameEn || '未知'
      const company = card.company ? `（${card.company}）` : ''
      return `${i + 1}. ${name}${company} ⭐${card.score}/10 ${card.category}`
    }),
    '',
    '📌 場合資訊與服務項目可至後台補充',
  ]

  await pushMessage(lineUserId, lines.join('\n'))
}

// ── Postback 處理（名片掃描後的快速按鈕，維持固定流程） ──────
async function handlePostback(data: string, replyToken: string, lineUserId: string) {
  const srcMatch = data.match(/^src:(.+):(\w+)$/)
  if (srcMatch) {
    const [, source, contactId] = srcMatch
    const ok = await updateContactSource(lineUserId, contactId, source)
    await replyMessage(replyToken, ok ? `✅ 已記錄場合：${source}` : '⚠️ 找不到這筆聯絡人')
    return
  }

  const otherMatch = data.match(/^src_other:(\w+)$/)
  if (otherMatch) {
    await setPendingSource(lineUserId, otherMatch[1])
    await replyMessage(replyToken, '請直接輸入場合名稱，例如：\nBNI台中南區')
    return
  }

  const correctNameMatch = data.match(/^correct_name:(\w+)$/)
  if (correctNameMatch) {
    await setPendingCorrection(lineUserId, 'nameZh', correctNameMatch[1])
    await replyMessage(replyToken, '請輸入正確的名字：')
    return
  }

  const correctCompanyMatch = data.match(/^correct_company:(\w+)$/)
  if (correctCompanyMatch) {
    await setPendingCorrection(lineUserId, 'company', correctCompanyMatch[1])
    await replyMessage(replyToken, '請輸入正確的公司名稱：')
    return
  }
}

// ── 文字訊息：固定流程優先，其餘全部交給 AI agent ─────────────
async function handleTextMessage(text: string, replyToken: string, lineUserId: string) {
  const t = text.trim()

  // 快速回覆按鈕帶出的「場合名稱：」輸入
  const customSourceMatch = t.match(/^場合名稱：?(.+)$/)
  if (customSourceMatch) {
    const sourceName = customSourceMatch[1].trim()
    let contactId = await consumePendingSource(lineUserId)
    if (!contactId) {
      const latest = await getLatestContact(lineUserId)
      contactId = latest?.id || null
    }
    if (!contactId) {
      await replyMessage(replyToken, '⚠️ 找不到對應名片，請先掃描名片')
      return
    }
    const ok = await updateContactSource(lineUserId, contactId, sourceName)
    await replyMessage(replyToken, ok ? `✅ 已記錄場合：${sourceName}` : '⚠️ 找不到這筆聯絡人')
    return
  }

  // 按了「修正名字/公司」按鈕後的輸入
  const pendingCorr = await consumePendingCorrection(lineUserId)
  if (pendingCorr) {
    const ok = await updateContactField(lineUserId, pendingCorr.contactId, pendingCorr.field, t)
    if (!ok) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    const label = pendingCorr.field === 'nameZh' ? '名字' : '公司名稱'
    await replyMessage(replyToken, `✅ 已修正${label}為：${t}`)
    return
  }

  // 名片缺服務項目時的補充輸入
  const pendingNoteId = await consumePendingNote(lineUserId)
  if (pendingNoteId) {
    await addContactNote(lineUserId, pendingNoteId, `服務項目：${t}`)
    await replyMessage(replyToken, `✅ 已補充服務項目：${t}`)
    return
  }

  // 其餘全部交給 agent：自然語言理解 + 工具呼叫 + 對話記憶
  const answer = await runAgent(lineUserId, t)
  await replyOrPush(replyToken, lineUserId, answer)
}

// ── 語音訊息：轉文字後進 agent ───────────────────────────────
async function handleAudioMessage(messageId: string, replyToken: string, lineUserId: string) {
  await replyMessage(replyToken, '🎧 收到語音，辨識中...')
  const audioBuffer = await downloadLineImage(messageId) // LINE 內容下載端點通用於圖片與語音
  const transcript = await transcribeAudio(audioBuffer)
  if (!transcript) {
    await pushMessage(lineUserId, '⚠️ 聽不清楚這段語音，可以再說一次嗎？')
    return
  }
  const answer = await runAgent(lineUserId, transcript)
  await pushMessage(lineUserId, `🎧 你說：「${transcript}」\n\n${answer}`)
}

// ── 主入口 ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-line-signature') || ''

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const data = JSON.parse(body)
  const allEvents: any[] = data.events || []
  const events = allEvents.filter(e => {
    if (isAllowedUser(e.source?.userId)) return true
    console.warn('Blocked non-allowlisted user:', e.source?.userId)
    return false
  })

  // 批次名片偵測：同一用戶、同一 webhook call 傳多張圖
  const imageEvents = events.filter(e => e.type === 'message' && e.message?.type === 'image')
  const otherEvents = events.filter(e => !(e.type === 'message' && e.message?.type === 'image'))

  if (imageEvents.length > 1) {
    const lineUserId = imageEvents[0].source?.userId
    try {
      await handleBatchImages(
        imageEvents.map((e: any) => ({ messageId: e.message.id, replyToken: e.replyToken })),
        lineUserId
      )
    } catch (err) {
      console.error('Batch image error:', err)
      await pushMessage(lineUserId, '⚠️ 批次掃描發生錯誤，請稍後再試')
    }
  } else if (imageEvents.length === 1) {
    const e = imageEvents[0]
    const lineUserId = e.source?.userId
    try {
      await handleImageMessage(e.message.id, e.replyToken, lineUserId)
    } catch (err) {
      console.error('Image handling error:', err)
      if (e.replyToken) await replyMessage(e.replyToken, '⚠️ 發生錯誤，請稍後再試')
    }
  }

  for (const event of otherEvents) {
    const lineUserId = event.source?.userId
    const replyToken = event.replyToken

    try {
      if (event.type === 'message' && event.message?.type === 'text') {
        await handleTextMessage(event.message.text, replyToken, lineUserId)
      } else if (event.type === 'message' && event.message?.type === 'audio') {
        await handleAudioMessage(event.message.id, replyToken, lineUserId)
      } else if (event.type === 'postback') {
        await handlePostback(event.postback.data, replyToken, lineUserId)
      }
    } catch (err) {
      console.error('Event handling error:', err)
      const msg = !process.env.ANTHROPIC_API_KEY
        ? '⚠️ AI 引擎尚未設定（缺少 ANTHROPIC_API_KEY），請先到 Vercel 環境變數補上'
        : '⚠️ 發生錯誤，請稍後再試'
      if (replyToken) {
        try { await replyMessage(replyToken, msg) } catch { await pushMessage(lineUserId, msg) }
      } else {
        await pushMessage(lineUserId, msg)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
