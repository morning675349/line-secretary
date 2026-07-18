export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import OpenAI from 'openai'
import {
  downloadLineImage, replyMessage, pushMessage,
  pushSourceQuickReply, pushAnalysisWithCorrect,
} from '@/lib/line-client'
import { analyzeCard, formatCardReply } from '@/lib/card-analyzer'
import { uploadCardImage } from '@/lib/storage'
import { db } from '@/lib/firebase-admin'
import {
  saveContact, getPendingFollowUps, searchContacts,
  updateContactStatus, updateContactSource, updateContactField,
  addContactNote, findContactByName, getContactStats,
  setPendingSource, consumePendingSource, getLatestContact,
  setPendingNote, consumePendingNote,
  setPendingCorrection, consumePendingCorrection,
} from '@/lib/contact-service'
import { parseSchedule } from '@/lib/schedule-parser'
import { createCalendarEvent, getAuthUrl, isCalendarConnected } from '@/lib/google-calendar'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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

  if (!card.services || card.services.length === 0) {
    await setPendingNote(lineUserId, contactId)
    const name = card.nameZh || card.nameEn || '這位聯絡人'
    await pushMessage(lineUserId, `🤔 ${name} 的名片沒有服務項目資訊\n你知道他們主要做什麼嗎？直接回覆我，我幫你存進去。`)
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

  // 依序處理，避免同時呼叫 OpenAI 影響辨識品質
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

// ── Postback 處理 ────────────────────────────────────────────
async function handlePostback(data: string, replyToken: string, lineUserId: string) {
  // BNI / 轉型創新協會 等固定場合
  const srcMatch = data.match(/^src:(.+):(\w+)$/)
  if (srcMatch) {
    const [, source, contactId] = srcMatch
    const ok = await updateContactSource(lineUserId, contactId, source)
    if (!ok) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    await replyMessage(replyToken, `✅ 已記錄場合：${source}`)
    return
  }

  // 其他場合 → 存 pending，等用戶輸入場合名稱
  const otherMatch = data.match(/^src_other:(\w+)$/)
  if (otherMatch) {
    await setPendingSource(lineUserId, otherMatch[1])
    await replyMessage(replyToken, '請直接輸入場合名稱，例如：\nBNI台中南區')
    return
  }

  // 修正名字
  const correctNameMatch = data.match(/^correct_name:(\w+)$/)
  if (correctNameMatch) {
    await setPendingCorrection(lineUserId, 'nameZh', correctNameMatch[1])
    await replyMessage(replyToken, '請輸入正確的名字：')
    return
  }

  // 修正公司
  const correctCompanyMatch = data.match(/^correct_company:(\w+)$/)
  if (correctCompanyMatch) {
    await setPendingCorrection(lineUserId, 'company', correctCompanyMatch[1])
    await replyMessage(replyToken, '請輸入正確的公司名稱：')
    return
  }
}

// ── 文字指令 ────────────────────────────────────────────────
async function handleTextMessage(text: string, replyToken: string, lineUserId: string) {
  const t = text.trim()

  // 修正名字：「修正名字：周致傑contactId」
  const correctNameMatch = t.match(/^修正名字：(.+)$/)
  if (correctNameMatch) {
    const parts = correctNameMatch[1].trim().split(' ')
    const contactId = parts[parts.length - 1]
    const newName = parts.slice(0, -1).join(' ') || parts[0]
    const ok = await updateContactField(lineUserId, contactId, 'nameZh', newName.trim())
    if (!ok) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    await replyMessage(replyToken, `✅ 名字已修正為：${newName.trim()}`)
    return
  }

  // 修正公司
  const correctCompanyMatch = t.match(/^修正公司：(.+)$/)
  if (correctCompanyMatch) {
    const parts = correctCompanyMatch[1].trim().split(' ')
    const contactId = parts[parts.length - 1]
    const newCompany = parts.slice(0, -1).join(' ') || parts[0]
    const ok = await updateContactField(lineUserId, contactId, 'company', newCompany.trim())
    if (!ok) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    await replyMessage(replyToken, `✅ 公司已修正為：${newCompany.trim()}`)
    return
  }

  // 自訂場合（可直接打，或接續「其他場合」按鈕後輸入）
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
    if (!ok) {
      await replyMessage(replyToken, '⚠️ 找不到這筆聯絡人')
      return
    }
    await replyMessage(replyToken, `✅ 已記錄場合：${sourceName}`)
    return
  }

  // 狀態更新：「已聯絡 王大明」「已提案 藝銘」「成交 周總」
  const statusMap: Record<string, string> = {
    '已聯絡': '已聯絡', '聯絡了': '已聯絡',
    '已提案': '已提案', '提案了': '已提案',
    '成交': '成交', '已成交': '成交',
    '已引薦': '引薦完成', '引薦完成': '引薦完成',
  }
  const statusMatch = t.match(/^(已聯絡|聯絡了|已提案|提案了|成交|已成交|已引薦|引薦完成)\s+(.+)$/)
  if (statusMatch) {
    const [, statusKey, name] = statusMatch
    const status = statusMap[statusKey] as '已聯絡' | '已提案' | '成交' | '引薦完成'
    const contact = await findContactByName(lineUserId, name)
    if (!contact || !contact.id) {
      await replyMessage(replyToken, `找不到「${name}」，請試試「找 ${name}」確認姓名`)
      return
    }
    await updateContactStatus(lineUserId, contact.id, status)
    const displayName = contact.nameZh || contact.nameEn || name
    await replyMessage(replyToken, `✅ ${displayName}（${contact.company}）\n狀態已更新為：${status}`)
    return
  }

  // 會議筆記：「筆記 王大明 今天聊了網站需求，有興趣3個月後開始」
  const noteMatch = t.match(/^筆記\s+(\S+)\s+(.+)$/)
  if (noteMatch) {
    const [, name, noteContent] = noteMatch
    const contact = await findContactByName(lineUserId, name)
    if (!contact || !contact.id) {
      await replyMessage(replyToken, `找不到「${name}」，請先確認姓名`)
      return
    }
    await addContactNote(lineUserId, contact.id, noteContent)
    const displayName = contact.nameZh || contact.nameEn || name
    await replyMessage(replyToken, `✅ 筆記已儲存\n👤 ${displayName}（${contact.company}）\n📝 ${noteContent}`)
    return
  }

  // 起草訊息：「幫我寫跟進信給王大明」「起草 周致傑」
  const draftMatch = t.match(/^(幫我寫|起草|draft)\s*.*?給?\s*(.+)$/)
  if (draftMatch) {
    const name = draftMatch[2].trim()
    const contact = await findContactByName(lineUserId, name)
    if (!contact) {
      await replyMessage(replyToken, `找不到「${name}」的資料，請先掃名片`)
      return
    }
    await replyMessage(replyToken, '✍️ 草稿生成中...')
    const displayName = contact.nameZh || contact.nameEn || name
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `你是一位整合行銷顧問的助理，幫主管起草中文跟進訊息。
主管背景：網站規劃顧問 + SEO顧問，服務中小企業主。
語氣：自然、專業、有溫度，不要官腔。訊息要短（100字內）。`,
        },
        {
          role: 'user',
          content: `幫我寫一則 LINE/WhatsApp 跟進訊息給：
姓名：${displayName}
公司：${contact.company}
職稱：${contact.title}
分類：${contact.category}
跟進建議：${contact.followUpSuggestion}
${contact.notes?.length ? `備註：${contact.notes.slice(-1)[0]}` : ''}`,
        },
      ],
      max_tokens: 300,
    })
    const draft = response.choices[0].message.content || ''
    await pushMessage(lineUserId, `✍️ 跟進訊息草稿：\n\n${draft}\n\n（可直接複製發送或修改後使用）`)
    return
  }

  // 圖文選單按鈕：掃名片（文字觸發）
  if (t === '掃名片') {
    await replyMessage(replyToken, '📷 請直接傳送名片照片，我會自動分析並儲存聯絡人資料。')
    return
  }

  // 統計
  if (t === '統計' || t === '人脈統計' || t === 'stats') {
    const stats = await getContactStats(lineUserId)
    const lines = [
      '📊 人脈庫統計',
      `總聯絡人：${stats.total} 人`,
      `本週新增：${stats.thisWeekNew} 人`,
      `DobBiz 潛力：${stats.dobBizCount} 人`,
      '',
      '📌 分類：',
      ...Object.entries(stats.byCategory).map(([k, v]) => `  ${k}：${v} 人`),
      '',
      '🏭 產業：',
      ...Object.entries(stats.byIndustry).slice(0, 5).map(([k, v]) => `  ${k}：${v} 人`),
      '',
      '⏳ 跟進狀態：',
      ...Object.entries(stats.byStatus).map(([k, v]) => `  ${k}：${v} 人`),
    ]
    await replyMessage(replyToken, lines.join('\n'))
    return
  }

  // 查詢跟進
  if (t === '跟進' || t === '跟進提醒' || t === '待跟進' || t === '提醒') {
    const contacts = await getPendingFollowUps(lineUserId)
    if (contacts.length === 0) {
      await replyMessage(replyToken, '✅ 目前沒有逾期的跟進任務！')
      return
    }
    const lines = ['📋 需要跟進的聯絡人：', '']
    contacts.forEach((c, i) => {
      const name = c.nameZh || c.nameEn || '未知'
      lines.push(`${i + 1}. ${name}（${c.company}）`)
      lines.push(`   ⭐ ${c.score}/10 · ${c.category}`)
      lines.push(`   💡 ${c.followUpSuggestion}`)
      lines.push('')
    })
    await replyMessage(replyToken, lines.join('\n'))
    return
  }

  // 圖文選單按鈕：搜尋聯絡人（文字觸發，引導輸入）
  if (t === '搜尋聯絡人') {
    await replyMessage(replyToken, '🔍 請輸入要搜尋的姓名或公司：\n\n例如：找 王大明\n例如：找 奇策')
    return
  }

  // 搜尋聯絡人
  if (t.startsWith('找 ') || t.startsWith('查 ') || t.startsWith('搜尋 ')) {
    const query = t.replace(/^(找|查|搜尋)\s+/, '')
    const contacts = await searchContacts(lineUserId, query)
    if (contacts.length === 0) {
      await replyMessage(replyToken, `找不到「${query}」相關的聯絡人`)
      return
    }
    const lines = [`🔍 搜尋「${query}」結果：`, '']
    contacts.forEach(c => {
      const name = c.nameZh || c.nameEn || '未知'
      lines.push(`👤 ${name} · ${c.company}`)
      lines.push(`   ${c.title} · ${c.mobile || c.officePhone || c.email}`)
      lines.push(`   ⭐ ${c.score}/10 · ${c.status}`)
      lines.push('')
    })
    await replyMessage(replyToken, lines.join('\n'))
    return
  }

  // 行程管理
  if (t === '連結行事曆' || t === '串行事曆' || t === 'connect calendar') {
    const connected = await isCalendarConnected(lineUserId)
    if (connected) {
      await replyMessage(replyToken, '✅ Google Calendar 已連結！\n\n直接說「排程 下週三下午3點跟林董在台中開會」就可以建立行程。')
    } else {
      const authUrl = await getAuthUrl(lineUserId)
      await replyMessage(replyToken, `請點以下連結授權 Google Calendar：\n\n${authUrl}`)
    }
    return
  }

  if (t === '排程' || t === '行程' || t === '新增行程') {
    const connected = await isCalendarConnected(lineUserId)
    if (!connected) {
      const authUrl = await getAuthUrl(lineUserId)
      await replyMessage(replyToken, `需要先連結 Google Calendar：\n\n${authUrl}`)
    } else {
      await replyMessage(replyToken, '請輸入行程詳情，例如：\n\n排程 下週三下午3點跟林董在台中開會')
    }
    return
  }

  if (/^(排程|行程|約)\s+/.test(t)) {
    const scheduleText = t.replace(/^(排程|行程|約)\s+/, '')
    const connected = await isCalendarConnected(lineUserId)
    if (!connected) {
      const authUrl = await getAuthUrl(lineUserId)
      await replyMessage(replyToken, `需要先連結 Google Calendar：\n\n${authUrl}`)
      return
    }
    await replyMessage(replyToken, '📅 解析行程中...')
    const parsed = await parseSchedule(scheduleText)
    if (!parsed.valid) {
      await pushMessage(lineUserId, `⚠️ 無法解析行程：${parsed.errorMessage}\n\n請試試：「排程 下週三下午3點跟林董在台中開會」`)
      return
    }
    const start = new Date(parsed.startDateTime)
    const end = new Date(parsed.endDateTime)
    const calLink = await createCalendarEvent(lineUserId, parsed.title, start, end, parsed.location)
    const timeStr = start.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    await pushMessage(
      lineUserId,
      `✅ 行程已建立！\n\n📅 ${parsed.title}\n🕐 ${timeStr}\n${parsed.location ? `📍 ${parsed.location}\n` : ''}${parsed.attendees ? `👥 ${parsed.attendees}\n` : ''}\n${calLink}`
    )
    return
  }

  // 若有待修正的欄位，直接更新
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

  // 若有待補充的服務項目，直接把輸入存成備註
  const pendingNoteId = await consumePendingNote(lineUserId)
  if (pendingNoteId) {
    await addContactNote(lineUserId, pendingNoteId, `服務項目：${t}`)
    await replyMessage(replyToken, `✅ 已補充服務項目：${t}`)
    return
  }

  // 說明選單
  await replyMessage(
    replyToken,
    `📌 隨身秘書指令：

📷 傳名片照片 → 自動分析＋儲存

📋 跟進管理：
「跟進」→ 查看待跟進
「已聯絡 王大明」→ 更新狀態
「找 公司名」→ 搜尋聯絡人
「統計」→ 人脈庫統計

📝 筆記與起草：
「筆記 王大明 聊了網站需求」
「幫我寫跟進信給王大明」

📅 行程管理：
「連結行事曆」→ 串接 Google Calendar
「排程 下週三下午3點跟林董開會」`
  )
}

// ── 主入口 ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-line-signature') || ''

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const data = JSON.parse(body)
  const events: any[] = data.events || []

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
      } else if (event.type === 'postback') {
        await handlePostback(event.postback.data, replyToken, lineUserId)
      }
    } catch (err) {
      console.error('Event handling error:', err)
      if (replyToken) await replyMessage(replyToken, '⚠️ 發生錯誤，請稍後再試')
    }
  }

  return NextResponse.json({ ok: true })
}
