export const dynamic = 'force-dynamic'
// Hobby 方案的硬上限就是 60 秒，寫 300 只會被靜默忽略並誤導後續維護者。
// 升級 Pro 之後可以調高，同時記得放寬下面的 BATCH_DEADLINE_MS。
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  downloadLineImage, replyMessage, pushMessage,
  pushSourceQuickReply, pushSourceDetected, pushAnalysisWithCorrect,
} from '@/lib/line-client'
import { findEventAround, MatchedEvent } from '@/lib/google-calendar'
import { analyzeCard, formatCardReply } from '@/lib/card-analyzer'
import { uploadCardImage } from '@/lib/storage'
import { db } from '@/lib/firebase-admin'
import {
  saveContact, updateContactSource, updateContactField, addContactNote,
  getContactById, updateContactStatus,
  setPendingSource, consumePendingSource, getLatestContact,
  setPendingNote, consumePendingNote,
  setPendingCorrection, consumePendingCorrection,
} from '@/lib/contact-service'
import { runAgent } from '@/lib/agent'
import { claimEvent } from '@/lib/dedup'
import { getExpoMode, bumpExpoCount, ExpoMode } from '@/lib/expo-mode'
import { runBatch } from '@/lib/batch'
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

// 回覆優先用 replyToken（不佔推播額度），agent 跑太久 token 過期就改用 push。
// replyMessage 現在會在 LINE 回非 2xx 時丟例外，這個 fallback 才真正有作用。
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

// 錯誤通知本身失敗時不能再往外丟，否則 webhook 回 500 會讓 LINE 反覆重送，
// 造成同一則訊息被處理多次（名片重複建檔、agent 重複計費）。
async function notifyFailureQuietly(replyToken: string, lineUserId: string, text: string) {
  try {
    await replyOrPush(replyToken, lineUserId, text)
  } catch (err) {
    console.error('Failed to deliver error notice to user:', err)
  }
}

// 把偵測到的活動寫成場合＋筆記，讓「在哪認識這個人」變成自動記錄的事實
async function recordSource(lineUserId: string, contactId: string, ev: MatchedEvent) {
  await updateContactSource(lineUserId, contactId, ev.title)
  await addContactNote(
    lineUserId, contactId,
    `在「${ev.title}」認識${ev.location ? `（${ev.location}）` : ''}`
  )
}

function sourceDetectedText(ev: MatchedEvent): string {
  return [
    `📍 已記錄場合：${ev.title}`,
    `🕐 ${ev.when}`,
    ev.location ? `📌 ${ev.location}` : '',
    '',
    '不是這個場合的話，按下面修改。',
  ].filter(Boolean).join('\n')
}

// 展場模式下，一次掃幾十張名片，每張回三則訊息會把通知洗爆，
// 所以改成只回一行進度。時間預算抓在 Vercel Hobby 60 秒上限之前。
// deadline 只擋「還沒開始」的工作，不會中斷進行中的。
// 最壞情況是 deadline 前一刻才開跑的那張再花 15 秒，加上收尾推播，
// 所以預算要抓在 60 秒上限減去（單張最久 + 推播時間）。
const BATCH_DEADLINE_MS = 32_000
const BATCH_CONCURRENCY = 3

type ScanResult = { card: Awaited<ReturnType<typeof analyzeCard>>; contactId: string }

/** 掃一張名片並建檔，場合優先用展場模式宣告的名稱，其次才問日曆 */
async function scanCard(
  messageId: string, lineUserId: string, expo: ExpoMode | null, matched: MatchedEvent | null
): Promise<ScanResult> {
  const imageBuffer = await downloadLineImage(messageId)
  const card = await analyzeCard(imageBuffer)
  const contactId = await saveContact(lineUserId, card)

  uploadCardImage(imageBuffer, contactId)
    .then(url => db.collection('contacts').doc(contactId).update({ cardImageUrl: url }))
    .catch(err => console.error('Card image upload failed:', err))

  if (expo) {
    await updateContactSource(lineUserId, contactId, expo.source)
    await addContactNote(lineUserId, contactId, `在「${expo.source}」認識`)
  } else if (matched) {
    await recordSource(lineUserId, contactId, matched)
  }

  return { card, contactId }
}

function cardLine(card: ScanResult['card'], index?: number): string {
  const name = card.nameZh || card.nameEn || '未知'
  const company = card.company ? `（${card.company}）` : ''
  const prefix = index === undefined ? '' : `${index}. `
  return `${prefix}${name}${company} ⭐${card.score}/10 ${card.category}`
}

// ── 名片掃描（單張）────────────────────────────────────────
async function handleImageMessage(messageId: string, replyToken: string, lineUserId: string) {
  const expo = await getExpoMode(lineUserId)

  // 展場模式：極簡回覆，不追問、不逐張確認場合
  if (expo) {
    const { card } = await scanCard(messageId, lineUserId, expo, null)
    const total = await bumpExpoCount(lineUserId)
    await replyOrPush(replyToken, lineUserId, `📇 第 ${total} 張｜${cardLine(card)}`)
    return
  }

  await replyMessage(replyToken, '📷 收到名片，分析中...')

  // 從日曆推測認識場合：拍名片的當下通常正在某個活動裡
  const matched = await findEventAround(lineUserId, new Date())
  const { card, contactId } = await scanCard(messageId, lineUserId, null, matched)

  const followUpDate = new Date()
  followUpDate.setDate(followUpDate.getDate() + card.followUpDays)
  await pushAnalysisWithCorrect(lineUserId, formatCardReply(card, followUpDate), contactId)

  if (matched) {
    await pushSourceDetected(lineUserId, contactId, sourceDetectedText(matched))
  } else {
    await pushSourceQuickReply(lineUserId, contactId)
  }

  // 讓 agent 的對話記憶知道剛掃了誰，之後「他的電話多少？」接得上
  const displayName = card.nameZh || card.nameEn || '未知'
  appendSystemNote(
    lineUserId,
    `剛掃描了一張名片並建檔：${displayName}（${card.company}）${matched ? `，場合是「${matched.title}」` : ''}`
  ).catch(err => console.error('Conversation note failed:', err))

  if (!card.services || card.services.length === 0) {
    await setPendingNote(lineUserId, contactId)
    await pushMessage(lineUserId, `🤔 ${displayName} 的名片沒有服務項目資訊\n你知道他們主要做什麼嗎？直接回覆我，我幫你存進去。`)
  }
}

// ── 名片掃描（批次）────────────────────────────────────────
// 限流並行取代原本的逐張序列：序列處理超過 4 張就會撞到 Hobby 的 60 秒上限，
// 而且是靜默被砍。現在超時的張數會明確回報，不會不明不白消失。
async function handleBatchImages(events: { messageId: string; replyToken: string }[], lineUserId: string) {
  const expo = await getExpoMode(lineUserId)

  if (events[0].replyToken) {
    await replyMessage(events[0].replyToken, `📷 收到 ${events.length} 張名片，分析中...`)
  }

  // 一疊名片通常來自同一場活動，只查一次日曆就好；展場模式下連查都不用
  const matched = expo ? null : await findEventAround(lineUserId, new Date())

  const outcome = await runBatch(
    events.map(e => e.messageId),
    messageId => scanCard(messageId, lineUserId, expo, matched),
    { concurrency: BATCH_CONCURRENCY, deadlineAt: Date.now() + BATCH_DEADLINE_MS }
  )

  outcome.failed.forEach(f => console.error('Card scan failed:', f.error))

  if (expo) {
    const total = await bumpExpoCount(lineUserId, outcome.done.length)
    const notes = [
      ...(outcome.failed.length ? [`⚠️ ${outcome.failed.length} 張辨識失敗`] : []),
      ...(outcome.skipped.length ? [`⏳ ${outcome.skipped.length} 張來不及處理，請再傳一次`] : []),
    ]
    await pushMessage(
      lineUserId,
      [`📇 本批 ${outcome.done.length} 張｜累計 ${total} 張`, ...notes].join('\n')
    )
    return
  }

  const lines = [
    `✅ 批次掃描完成！共 ${outcome.done.length} 張名片`,
    ...(outcome.failed.length > 0 ? [`⚠️ ${outcome.failed.length} 張分析失敗`] : []),
    ...(outcome.skipped.length > 0 ? [`⏳ ${outcome.skipped.length} 張因處理時間不足未完成，請再傳一次`] : []),
    ...(matched ? [`📍 場合：${matched.title}（已自動記錄）`] : []),
    '',
    ...outcome.done.map(({ result }, i) => cardLine(result.card, i + 1)),
    '',
    matched ? '📌 場合記錯的話跟我說一聲，我幫你改' : '📌 場合資訊與服務項目可至後台補充',
  ]

  await pushMessage(lineUserId, lines.join('\n'))
}

// ── Postback 處理（名片掃描後的快速按鈕，維持固定流程） ──────
async function handlePostback(data: string, replyToken: string, lineUserId: string) {
  // Flex 卡片上的「起草跟進訊息」：轉交 agent，沿用它既有的草稿邏輯與筆記脈絡
  const draftMatch = data.match(/^draft:(\w+)$/)
  if (draftMatch) {
    const contact = await getContactById(lineUserId, draftMatch[1])
    if (!contact) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    const displayName = contact.nameZh || contact.nameEn || '這位聯絡人'
    await replyMessage(replyToken, `✍️ 正在幫你寫給 ${displayName} 的跟進訊息...`)
    const answer = await runAgent(lineUserId, `幫我寫一則跟進訊息給 ${displayName}（${contact.company}）`)
    await pushMessage(lineUserId, answer)
    return
  }

  // Flex 卡片上的「標記已聯絡」
  const contactedMatch = data.match(/^contacted:(\w+)$/)
  if (contactedMatch) {
    const contact = await getContactById(lineUserId, contactedMatch[1])
    if (!contact || !contact.id) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    await updateContactStatus(lineUserId, contact.id, '已聯絡')
    const displayName = contact.nameZh || contact.nameEn || '這位聯絡人'
    await replyMessage(replyToken, `✅ ${displayName}（${contact.company}）已標記為已聯絡`)
    return
  }

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
  const allowed = allEvents.filter(e => {
    if (isAllowedUser(e.source?.userId)) return true
    console.warn('Blocked non-allowlisted user:', e.source?.userId)
    return false
  })

  // 事件去重：LINE 在回應太慢時會重送整批事件，沒擋掉就會同一張名片建兩筆聯絡人。
  // claimEvent 用 Firestore 的 create() 做原子性認領，第二次認領同一個 id 會失敗。
  const claims = await Promise.all(
    allowed.map(async e => ({ event: e, fresh: await claimEvent(e.webhookEventId || e.message?.id || '') }))
  )
  const events = claims.filter(c => c.fresh).map(c => c.event)
  if (events.length < allowed.length) {
    console.warn(`Skipped ${allowed.length - events.length} duplicate LINE event(s)`)
  }

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
      await notifyFailureQuietly('', lineUserId, '⚠️ 批次掃描發生錯誤，請稍後再試')
    }
  } else if (imageEvents.length === 1) {
    const e = imageEvents[0]
    const lineUserId = e.source?.userId
    try {
      await handleImageMessage(e.message.id, e.replyToken, lineUserId)
    } catch (err) {
      console.error('Image handling error:', err)
      await notifyFailureQuietly(e.replyToken, lineUserId, '⚠️ 發生錯誤，請稍後再試')
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
      const msg = !process.env.OPENAI_API_KEY
        ? '⚠️ AI 引擎尚未設定（缺少 OPENAI_API_KEY），請先到 Vercel 環境變數補上'
        : '⚠️ 發生錯誤，請稍後再試'
      await notifyFailureQuietly(replyToken, lineUserId, msg)
    }
  }

  return NextResponse.json({ ok: true })
}
