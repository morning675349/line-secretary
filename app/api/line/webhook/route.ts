export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { downloadLineImage, replyMessage, pushMessage, pushSourceQuickReply } from '@/lib/line-client'
import { analyzeCard, formatCardReply } from '@/lib/card-analyzer'
import { saveContact, getPendingFollowUps, searchContacts, updateContactSource } from '@/lib/contact-service'

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET || ''
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64')
  return hash === signature
}

async function handleImageMessage(messageId: string, replyToken: string, lineUserId: string) {
  await replyMessage(replyToken, '📷 收到名片，分析中...')

  const imageBuffer = await downloadLineImage(messageId)
  const card = await analyzeCard(imageBuffer)

  const followUpDate = new Date()
  followUpDate.setDate(followUpDate.getDate() + card.followUpDays)

  const contactId = await saveContact(lineUserId, card)

  await pushMessage(lineUserId, formatCardReply(card, followUpDate))
  await pushSourceQuickReply(lineUserId, contactId)
}

async function handlePostback(data: string, replyToken: string) {
  // src:BNI:contactId 或 src:轉型創新協會:contactId
  const fixedMatch = data.match(/^src:(.+):(\w+)$/)
  if (fixedMatch) {
    const [, source, contactId] = fixedMatch
    await updateContactSource(contactId, source)
    await replyMessage(replyToken, `✅ 已記錄：${source}`)
    return
  }

  // src_other:contactId → 等待使用者輸入自訂場合
  const otherMatch = data.match(/^src_other:(\w+)$/)
  if (otherMatch) {
    // fillInText 會讓使用者輸入，輸入的文字會以 "場合名稱：xxx contactId" 格式送回
    // 這裡先不做任何事，由 handleTextMessage 的 custom source 段落處理
    return
  }
}

async function handleTextMessage(text: string, replyToken: string, lineUserId: string) {
  const t = text.trim()

  // 自訂場合輸入：「場合名稱：台中商業午餐 contactId」
  const customSourceMatch = t.match(/^場合名稱：(.+)\s+(\w+)$/)
  if (customSourceMatch) {
    const [, source, contactId] = customSourceMatch
    await updateContactSource(contactId, source.trim())
    await replyMessage(replyToken, `✅ 已記錄：${source.trim()}`)
    return
  }

  // 查詢跟進提醒
  if (t === '跟進' || t === '待跟進' || t === '提醒') {
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

  // 搜尋聯絡人
  if (t.startsWith('找 ') || t.startsWith('查 ') || t.startsWith('搜尋 ')) {
    const query = t.replace(/^(找|查|搜尋)\s+/, '')
    const contacts = await searchContacts(lineUserId, query)
    if (contacts.length === 0) {
      await replyMessage(replyToken, `找不到「${query}」相關的聯絡人`)
      return
    }
    const lines = [`🔍 搜尋「${query}」結果：`, '']
    contacts.slice(0, 5).forEach(c => {
      const name = c.nameZh || c.nameEn || '未知'
      lines.push(`👤 ${name} · ${c.company}`)
      lines.push(`   ${c.title} · ${c.mobile || c.officePhone || c.email}`)
      lines.push(`   ⭐ ${c.score}/10 · ${c.status}`)
      lines.push('')
    })
    await replyMessage(replyToken, lines.join('\n'))
    return
  }

  // 說明選單
  await replyMessage(
    replyToken,
    '📌 隨身秘書指令：\n\n📷 傳名片照片 → 自動分析＋儲存\n「跟進」→ 查看需要跟進的人\n「找 公司名」→ 搜尋聯絡人'
  )
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-line-signature') || ''

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const data = JSON.parse(body)

  for (const event of data.events || []) {
    const lineUserId = event.source?.userId
    const replyToken = event.replyToken

    try {
      if (event.type === 'message') {
        const { message } = event
        if (message.type === 'image') {
          await handleImageMessage(message.id, replyToken, lineUserId)
        } else if (message.type === 'text') {
          await handleTextMessage(message.text, replyToken, lineUserId)
        }
      } else if (event.type === 'postback') {
        await handlePostback(event.postback.data, replyToken)
      }
    } catch (err) {
      console.error('Event handling error:', err)
      if (replyToken) await replyMessage(replyToken, '⚠️ 發生錯誤，請稍後再試')
    }
  }

  return NextResponse.json({ ok: true })
}
