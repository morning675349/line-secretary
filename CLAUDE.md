@AGENTS.md

# LINE 特助系統（line-secretary）

晨安的個人特助，Bot 名稱是**「安安特助」**：LINE Bot 加 Google 日曆、名片辨識、聯絡人管理。

Next.js + Firebase。

**Firebase 專案 ID 是 `special-assistant-9a791`**，不是 `special-assistant`，也不是資料夾名稱。判斷依據是服務帳號信箱 `...@special-assistant-9a791.iam.gserviceaccount.com`，那個網域段才是真正的專案 ID。2026-07-27 之前 `.env.local` 一直寫成 `special assistant`（中間是空格），所以本機根本連不上 Firestore，只有正式環境是對的。

## 最大的坑：Vercel 專案對不上

**本機 `.vercel/project.json` 連到的是錯的專案**（`wcmep-quote-system`），不要相信它。

Vercel team `wcmep-s-projects` 底下有三個容易搞混的專案：

| 專案 | 狀態 |
|---|---|
| `line-secretary` | 沒有任何環境變數，**不是**上線用的 |
| `line-secretary-m6ji` | **這才是真正上線中的**，https://line-secretary-m6ji.vercel.app |
| `wcmep-quote-system` | 完全不相關，但本機錯誤連到它 |

**部署一律用 `git push origin main`。**

這個專案接了 GitHub 自動部署，push 完幾分鐘內就會正確上線。

**不要在本機資料夾跑 `vercel --prod`**，2026-07-18 這樣做過一次，原始碼被送到 `wcmep-quote-system` 建置，因缺 `OPENAI_API_KEY` 失敗。所幸失敗不影響正式別名。

真的要用 CLI 操作 env 時，先用 `vercel env ls production` 確認看得到 `FIREBASE_STORAGE_BUCKET` 那一整組變數，那才是對的專案。

## 其他要知道的事

- **AI 引擎是 OpenAI `gpt-5.5`**，模型字串集中在 `lib/ai.ts` 的 `AGENT_MODEL`，要升級只改那一行。曾一度改用 Claude，但使用者不想多開一個供應商帳單，故改回 OpenAI，沿用既有的 `OPENAI_API_KEY`。
- **`ALLOWED_LINE_USER_IDS` 建議要設**。逗號分隔的 LINE userId 白名單，未設定等於全放行。agent 每句話都有 API 成本，陌生人加好友就能燒錢。晨安本人的 userId 是 `Ud76a9b031cc52467382e5f22380c1a3e`。
- **Vercel 方案是 Hobby**，函式上限 60 秒，程式裡寫的 `maxDuration = 300` 會被靜默無視。一次掃超過 5 張名片有跑到一半被砍的風險，且不會有錯誤訊息。要根治得改成「先回應再背景分批處理」，或升級 Pro。
- **`CRON_SECRET` 在 Vercel 被標記為 Sensitive，值讀不回來**。需要在本機用健康檢查時，只能重新產生一組（`openssl rand -hex 32`）兩邊同步，不要試圖從 Vercel 複製。
- **後台密碼**在 `.env.local` 的 `ADMIN_PASSWORD`，同時存在 Vercel 的 `line-secretary-m6ji`（production 與 development）。若使用者說忘記密碼，直接看 `.env.local` 或引導他去那個專案的 Environment Variables 頁面，不要再重複掃描其他專案。

## 架構現況（Phase 1 大腦升級，2026-07-26 已上線）

已從 regex 指令比對改成 tool-calling agent。

- `lib/agent.ts`：13 個工具，手動迴圈最多 8 輪
- `lib/conversation.ts`：對話記憶存 Firestore `conversations`，6 小時或 12 輪
- `lib/transcribe.ts`：語音訊息走 Whisper 轉文字再進 agent
- 名片 OCR 改用 vision 加 `json_schema` strict，掃描後的場合與修正按鈕仍走 pending 快速流程
- 登入走 `lib/admin-session.ts` 簽發的 HMAC session token，常數時間雜湊比對，15 分鐘 5 次失敗鎖定（2026-07-18 OWASP 修復後的版本）

## 認識場合自動判定（2026-07-27）

掃名片時自動從 Google 日曆判定「在哪認識這個人」，不用再手動按按鈕選。

- 判定邏輯在 `lib/event-matching.ts`，是**純函式、零 I/O**，所以能單獨測試。改評分規則請改這裡
- 評分：進行中 100，剛散會 80 遞減到 50（3 小時內），提早到場 60 遞減到 40（2 小時內），整天活動 45
- 整天活動壓在「剛散會」之下是刻意的：展期中若另有具體會議，那場會議才是真正認識人的場合
- Google 日曆的整天活動 `end.date` 是**不含當天的隔天**，判斷區間要用 `start <= 當天 < end`
- 日曆沒連結或 API 出錯時回傳 null，退回原本的固定按鈕，不會中斷掃名片流程
- 批次掃描只查一次日曆，整疊名片套用同一個場合

舊資料回補走 agent 的兩段式工具：`preview_source_backfill` 產生提案存進 Firestore 的 `pendingBackfill`，使用者確認後才用 `apply_source_backfill` 寫入。**system prompt 有明確禁止跳過確認**，改動時不要拿掉。單次最多掃 20 個日期，超過會在回覆裡告知還剩幾天沒掃。

## LINE 憑證：失效時怎麼換（2026-07-27 實際跑過）

Channel access token 失效的症狀很有欺騙性：站台 200、webhook 200、agent 正常執行，**唯一症狀是使用者完全收不到回覆**。判斷方法是直接問 LINE 官方 API：

```
curl -s https://api.line.me/v2/bot/info -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN"
```

回 `Authentication failed` 就是 token 死了。長期 token 不會自己過期，失效幾乎都是因為有人在 Console 按過 Issue，舊的當下就作廢。

重新發行路徑（這條路當時找了好幾輪）：

1. https://developers.line.biz/console/ → 左側 Provider 選 **安安特助**（不是奇策整合行銷等客戶用的 Provider）
2. 該頁**往上捲**才看得到現有頻道，往下捲會看到「Create a channel」誤以為沒有頻道
3. 進頻道後先在 **Basic settings** 確認 Channel secret 開頭是 `01a090`，確保沒選錯
4. 切 **Messaging API** 分頁，**捲到最底部** 的 Channel access token (long-lived) → Issue，舊 token 失效時間選 0
5. 貼到 Vercel `line-secretary-m6ji` 的 `LINE_CHANNEL_ACCESS_TOKEN`
6. **Vercel 環境變數改完一定要重新部署才生效**，用 `git commit --allow-empty` 推一次即可

同一頁順便確認：Webhook URL 正確、Use webhook 開啟、Auto-reply messages 關閉（後者會用罐頭訊息蓋掉 webhook 回覆，症狀很像壞掉）。

## 健康檢查（出問題先跑這個）

```
curl -H "Authorization: Bearer $CRON_SECRET" https://line-secretary-m6ji.vercel.app/api/health
```

一次檢查環境變數、LINE token、Firestore、OpenAI 四項，全過回 200，任一項掛掉回 503 並指出是哪一項。

**這支端點是 2026-07-27 事故的產物。** 當時 LINE access token 失效，但站台 200、webhook 200、agent 跑得好好的，唯一症狀是使用者收不到任何回覆。原因是 `lib/line-client.ts` 所有 fetch 都不檢查回應，LINE 回 401 也當成成功。現在 `callLineApi` 會檢查 `res.ok` 並丟例外，token 失效時 log 會直接寫出「請重新發行」。

**送訊失敗絕對不要改回靜默忽略**，那會讓整個系統失去自我察覺能力。

## 資料層的兩個地雷

**不要用 `where` 加 `orderBy` 的複合查詢。** Firestore 需要另外建索引，沒建就整支拋錯。早報 (`api/cron/daily-briefing`) 就是這樣從上線起無聲失敗到 2026-07-27 才被發現，因為錯誤被 try/catch 吞掉。`lib/contact-service.ts` 的 `getPendingFollowUps` 是刻意改成全撈進記憶體再過濾的版本，要查跟進名單一律用它。

**目前所有查詢都是全集合掃描再用 JS 過濾**（`searchContacts`、`getContactStats`、`getContactsNeedingSource`）。64 筆時無感，上千筆會明顯變慢且 Firestore 讀取費用線性成長。真的要擴充再處理，不用提前優化。

## 測試

`npm test`（Node 內建 test runner 加 `--experimental-strip-types`，不需額外依賴）。

目前只涵蓋 `lib/event-matching.ts` 的 13 個情境。因為要讓 Node 直接跑 .ts，測試檔的 import 需要帶 `.ts` 副檔名，tsconfig 因此開了 `allowImportingTsExtensions`。

## 環境地雷：這個專案在 iCloud Drive 裡

`node_modules` 放在 iCloud 同步目錄，**大檔案會同步不完整**。

2026-07-27 踩過：`npm install` 之後 `typescript/lib/lib.dom.d.ts` 和 `lib.es5.d.ts` 兩個最大的檔案沒被寫進去（88 個 .d.ts，正常要 102 個），`npx tsc` 噴一堆 `Cannot find global type 'Boolean'`。同一個指令在 iCloud 外面裝就完全正常。

**修法：`npm ci`**（`npm install`、`--force`、單獨重裝 typescript 都救不回來）。

iCloud 還會產生檔名帶「 2」的衝突副本，例如 `.next/types/routes.d 2.ts`，會讓 tsc 報 duplicate identifier。用 `find .next -name "* 2.*" -delete` 清掉。

`app/favicon.ico` 也被 iCloud 清成 0 bytes 過，commit 前記得看一下 `git status` 有沒有莫名其妙的檔案變動。

## Phase 2/3 規劃（尚未動工）

Flex Message 卡片介面、早報快速回覆按鈕、會前情報推播、人脈週報、行事曆改期與刪除、webhook 先回應再背景處理加事件去重。
