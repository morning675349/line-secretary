// LINE 圖文選單：定義與上架流程。
//
// 底圖由 scripts/generate-richmenu.py 產生（public/richmenu.png，2500x1686）。
// ⚠️ 這裡的 areas 座標必須跟那支腳本的 CELLS 順序一一對應（3 欄 2 列，左上到右下），
// 改了其中一邊沒改另一邊，使用者就會按到錯的功能。
//
// 按鈕分兩類：
// - message：直接送一句話給 agent 處理（自然語言理解，能查資料）
// - postback：不需要 AI 判斷的固定動作，或需要叫出鍵盤讓使用者補字（省一次 API 費用）

const LINE_API = 'https://api.line.me/v2/bot'
const LINE_DATA_API = 'https://api-data.line.me/v2/bot'

const CW = 833      // 2500 / 3，中間那格補 1px
const CH = 843      // 1686 / 2

export const RICH_MENU = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: '安安特助選單 v2',
  chatBarText: '📋 打開選單',
  areas: [
    // 上排
    {
      bounds: { x: 0, y: 0, width: CW, height: CH },
      action: { type: 'postback', label: '掃名片', data: 'menu:scan', displayText: '掃名片' },
    },
    {
      bounds: { x: CW, y: 0, width: CW + 1, height: CH },
      action: { type: 'message', label: '待跟進', text: '跟進' },
    },
    {
      bounds: { x: CW * 2 + 1, y: 0, width: CW, height: CH },
      action: {
        type: 'postback', label: '找人', data: 'menu:search',
        inputOption: 'openKeyboard', fillInText: '找 ',
      },
    },
    // 下排
    {
      bounds: { x: 0, y: CH, width: CW, height: CH },
      action: { type: 'message', label: '今日行程', text: '今天的行程' },
    },
    {
      bounds: { x: CW, y: CH, width: CW + 1, height: CH },
      action: { type: 'message', label: '業務戰情', text: '業務進度' },
    },
    {
      bounds: { x: CW * 2 + 1, y: CH, width: CW, height: CH },
      action: {
        type: 'postback', label: '展場模式', data: 'menu:expo',
        inputOption: 'openKeyboard', fillInText: '進入展場模式：',
      },
    },
  ],
}

function authHeader(): string {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set')
  return `Bearer ${token}`
}

async function lineJson(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${LINE_API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`LINE ${path} 失敗：${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

export interface SetupResult {
  richMenuId: string
  deletedOld: string[]
  imageBytes: number
}

/**
 * 建立選單 → 上傳底圖 → 設為所有使用者的預設 → 清掉舊選單。
 * 順序很重要：先設好新的預設再刪舊的，中間不會有「沒有選單」的空窗。
 */
export async function setupRichMenu(image: Buffer): Promise<SetupResult> {
  const before = (await lineJson('/richmenu/list', { method: 'GET' })) as { richmenus?: { richMenuId: string }[] }
  const oldIds = (before.richmenus || []).map(m => m.richMenuId)

  const created = (await lineJson('/richmenu', {
    method: 'POST',
    body: JSON.stringify(RICH_MENU),
  })) as { richMenuId: string }
  const richMenuId = created.richMenuId
  if (!richMenuId) throw new Error('建立選單成功但沒拿到 richMenuId')

  const upload = await fetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'image/png' },
    body: new Uint8Array(image),
  })
  if (!upload.ok) {
    const body = await upload.text().catch(() => '')
    throw new Error(`底圖上傳失敗：${upload.status} ${body.slice(0, 300)}`)
  }

  await lineJson(`/user/all/richmenu/${richMenuId}`, { method: 'POST' })

  // 舊選單留著只會佔額度並在後台造成混淆；刪失敗不影響新選單，記 log 就好
  const deletedOld: string[] = []
  for (const id of oldIds) {
    try {
      await lineJson(`/richmenu/${id}`, { method: 'DELETE' })
      deletedOld.push(id)
    } catch (err) {
      console.error('刪除舊選單失敗', id, err)
    }
  }

  return { richMenuId, deletedOld, imageBytes: image.byteLength }
}
