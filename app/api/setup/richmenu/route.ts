export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

const LINE_API = 'https://api.line.me/v2/bot'
const headers = {
  Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
}

const richMenuBody = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '隨身秘書選單',
  chatBarText: '📋 秘書選單',
  areas: [
    // 上排
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'message', label: '掃名片', text: '掃名片' },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: 'message', label: '跟進提醒', text: '跟進' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'message', label: '人脈統計', text: '統計' },
    },
    // 下排
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: {
        type: 'postback',
        label: '新增行程',
        data: 'open_schedule',
        inputOption: 'openKeyboard',
        fillInText: '排程 ',
      },
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: {
        type: 'postback',
        label: '搜尋聯絡人',
        data: 'open_search',
        inputOption: 'openKeyboard',
        fillInText: '找 ',
      },
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: 'message', label: '指令說明', text: '指令說明' },
    },
  ],
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 建立選單結構
    const createRes = await fetch(`${LINE_API}/richmenu`, {
      method: 'POST',
      headers,
      body: JSON.stringify(richMenuBody),
    })
    const result = await createRes.json()
    const richMenuId = result.richMenuId
    if (!richMenuId) throw new Error(`Create failed: ${JSON.stringify(result)}`)

    return NextResponse.json({
      ok: true,
      richMenuId,
      nextStep: `請到 LINE OA Manager → 圖文選單 → 找到 richMenuId: ${richMenuId} → 上傳圖片後啟用`,
    })
  } catch (err) {
    console.error('Rich menu setup error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
