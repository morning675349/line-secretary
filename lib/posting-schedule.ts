// DoBBiz 社群「每日發文提醒」排程（純函式，比照 event-matching / business-progress 模式，方便單獨測試）。
//
// 用途：在每日早報 (api/cron/daily-briefing) 附一句「今天該發什麼」，只推給帳號本人。
// 排程理念（養號期）：一天一篇、每天輪不同內容類型；「台灣傳產必追」系列穿插不同產業發。
// ⚠️ 這是養號期時效性排程，養號結束（連續數週未被限流）後可整組改寫或移除。
// 要改內容只改下面 WEEKLY_PLAN 一處。

// 只有帳號本人會收到發文提醒（其他 LINE 使用者不該收到 DoBBiz 排程）。
export const POSTING_REMINDER_OWNER = 'Ud76a9b031cc52467382e5f22380c1a3e'

// 星期 → 當天發文提醒（0 = 週日）
const WEEKLY_PLAN: Record<number, string> = {
  1: '📌【台灣傳產必追】發一集：從分類表挑一個產業、選 5 家（記得逐一核對 @handle）',
  2: '🛁 發「製程影片 / 職人日常」：輕鬆有梗、好轉發',
  3: '📌【台灣傳產必追】換一個產業再發一集（跟週一不同產業）',
  4: '💡 發「跟傳產老闆聊天的觀點」或一句產業金句',
  5: '📰 發【本週製造快訊】：挑 3～5 則本週製造業新聞，跟 Claude 說「潤本週快訊」',
  6: '📌【台灣傳產必追】再換一個產業發一集，或發「平台上一家用心工廠」的故事',
  0: '😴 今天休息，不發文，只回留言養帳號',
}

const WD_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// 依台灣時區的星期回傳當天發文提醒。cron 在台灣早上 8 點跑，用 Asia/Taipei 才不會因 UTC 差一天。
export function getPostingReminder(date: Date): string {
  const wdShort = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(date)
  const wd = WD_INDEX[wdShort] ?? 1
  return WEEKLY_PLAN[wd]
}
