export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { downloadLineImage, replyMessage } from '@/lib/line-client'
import { analyzeCard, formatCardReply } from '@/lib/card-analyzer'
import { saveContact, getPendingFollowUps, searchContacts } from '@/lib/contact-service'

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET || ''
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64')
  return hash === signature
}

async function handleImageMessage(
  messageId: string,
  replyToken: string,
  lineUserId: string
) {
  await replyMessage(replyToken, '📷 收到名片，分析中...')

  const imageBuffer = await downloadLineImage(messageId)
  const card = await analyzeCard(imageBuffer)

  const followUpDate = new Date()
  followUpDate.setDate(followUpDate.getDate() + card.followUpDays)

  await saveContact(lineUserId, card)

  const reply = formatCardReply(card, followUpDate)
  // 使用 push 因為 replyToken 已用於第一則
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text: reply }],
    }),
  })
}

async function handleTextMessage(
  text: string,
  replyToken: string,
  lineUserId: string
) {
  const t = text.trim()

  // 查詢跟進提醒
  if (t === '跟進' || t === '待跟進' || t === '提醒') {
    const contacts = await getPendingFollowUps(lineUserId)
    if (contacts.length === 0) {
      await replyMessage(replyToken, '✅ 目前沒有逾期的跟進任務！')
      return
    }
    const lines = ['📋 需要跟進的聯絡人：', '']
    contacts.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.name}（${c.company}）`)
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
      lines.push(`👤 ${c.name} · ${c.company}`)
      lines.push(`   ${c.title} · ${c.phone || c.email}`)
      lines.push(`   ⭐ ${c.score}/10 · ${c.status}`)
      lines.push('')
    })
    await replyMessage(replyToken, lines.join('\n'))
    return
  }

  // 說明選單
  await replyMessage(
    replyToken,
    '📌 隨身秘書指令：\n\n📷 傳名片照片 → 自動分析＋儲存\n\n「跟進」→ 查看需要跟進的人\n「找 公司名」→ 搜尋聯絡人\n\n更多功能開發中...'
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
    if (event.type !== 'message') continue
    const { message, replyToken, source } = event
    const lineUserId = source.userId

    try {
      if (message.type === 'image') {
        await handleImageMessage(message.id, replyToken, lineUserId)
      } else if (message.type === 'text') {
        await handleTextMessage(message.text, replyToken, lineUserId)
      }
    } catch (err) {
      console.error('Event handling error:', err)
      await replyMessage(replyToken, '⚠️ 發生錯誤，請稍後再試')
    }
  }

  return NextResponse.json({ ok: true })
}
