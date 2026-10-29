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
- **Vercel 方案是 Hobby**，函式上限 60 秒，cron 一天只能觸發一次。批次掃名片已在 2026-09-09 改成限流並行加時間預算（見下方「逾時預算」），不再靜默被砍。
- **`CRON_SECRET` 在 Vercel 被標記為 Sensitive，值讀不回來**。需要在本機用健康檢查時，只能重新產生一組（`openssl rand -hex 32`）兩邊同步，不要試圖從 Vercel 複製。
- **後台密碼**在 `.env.local` 的 `ADMIN_PASSWORD`，同時存在 Vercel 的 `line-secretary-m6ji`（production 與 development）。若使用者說忘記密碼，直接看 `.env.local` 或引導他去那個專案的 Environment Variables 頁面，不要再重複掃描其他專案。

## 架構現況（Phase 1 大腦升級，2026-07-26 已上線）

已從 regex 指令比對改成 tool-calling agent。

- `lib/agent.ts`：28 個工具，手動迴圈最多 8 輪
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

## 業務戰情（2026-08-08）

記錄簽案與收款，追蹤三大觸發器進度。門檻數字來自 vault 的 `decisions/2026-08-04_奇策年度經營決策_顧問團診斷.md`，**改門檻只改 `lib/business-progress.ts` 頂部的常數**。

- `lib/deal-service.ts`：Firestore `deals` 與 `payments` 兩個集合，軟刪除（`voided: true`），查詢比照 contact-service 全撈記憶體過濾
- `lib/business-progress.ts`：進度計算純函式（比照 event-matching 模式），有完整測試
- agent 新增 5 個工具：`record_deal`、`record_payment`、`get_business_progress`、`list_business_records`、`void_business_record`
- 三大觸發器：買車里程碑（月簽約 38 萬 × 連續 3 月）、請製作人力（外包溢出 ≥2 案 × 連續 3 月）、請 SEO 執行（有效年約 ≥7 家，簽約後 12 個月內有效）
- 連續月數的計算刻意「本月未達標不斷開紀錄」，因為月中還在進行；本月達標才納入連續數
- `adsStatusLine` 是時間敏感的硬編碼（8/31 前置、9–11 月測試期、12 月起提醒收斂），2026 作戰計畫結束後要改寫或移除
- 口語金額由 agent 換算成元再進工具（12萬 → 120000），工具端只收純數字字串

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

共 128 項，涵蓋 `event-matching`、`meeting-intel`、`weekly-report`、`batch`、`flex`、`flex-scan`、`business-progress`、`posting-schedule`、`expo-report`、`expo-voice`、`csv`、`contact-merge`。

**這個專案的慣例是：會出錯的判斷邏輯一律抽成零 I/O 的純函式模組再測。**
碰 Firestore 或外部 API 的那層不寫測試，靠型別檢查與正式環境驗證。

因為要讓 Node 直接跑 .ts，測試檔的 import 需要帶 `.ts` 副檔名，tsconfig 因此開了 `allowImportingTsExtensions`。

## 環境地雷：這個專案在 iCloud Drive 裡

`node_modules` 放在 iCloud 同步目錄，**大檔案會同步不完整**。

2026-07-27 踩過：`npm install` 之後 `typescript/lib/lib.dom.d.ts` 和 `lib.es5.d.ts` 兩個最大的檔案沒被寫進去（88 個 .d.ts，正常要 102 個），`npx tsc` 噴一堆 `Cannot find global type 'Boolean'`。同一個指令在 iCloud 外面裝就完全正常。

**修法：`npm ci`**（`npm install`、`--force`、單獨重裝 typescript 都救不回來）。

iCloud 還會產生檔名帶「 2」的衝突副本，例如 `.next/types/routes.d 2.ts`，會讓 tsc 報 duplicate identifier。用 `find .next -name "* 2.*" -delete` 清掉。

`app/favicon.ico` 也被 iCloud 清成 0 bytes 過，commit 前記得看一下 `git status` 有沒有莫名其妙的檔案變動。

## 2026-09-09 這輪加的三塊

**會前情報**：早報的今日行程逐則附上「等下要見的是誰、上次聊到哪」。
比對邏輯在 `lib/meeting-intel.ts`（純函式）。只比對姓名全名與公司核心名，
**刻意不做單姓比對**，因為「林董」「林口」都會誤中。行事曆標題常寫簡稱，
所以公司名會取前 2 到 4 字當候選（「大展精密工業」也能被「大展精密」命中）。

**人脈與商機週報**：週日早報後另發一則，內容是本週業績、新增名片、
逾期未跟進、已提案未成交、DobBiz 潛力名單，結尾給一個明確動作。
邏輯在 `lib/weekly-report.ts`（純函式）。**沒東西可報時回傳 null 不發空報告。**

**展場模式**：`lib/expo-mode.ts`。開啟後掃名片自動套用宣告的場合、
回覆縮成一行進度、不再逐張追問。給 agent 的工具是 start/end/get_expo_status。
平常一張名片回三則訊息，展場連掃四十張會把通知洗爆，這個模式就是為五金展設計的。

**Flex 卡片**：`lib/flex.ts`。聯絡人卡片附撥號、起草跟進訊息、標記已聯絡三個按鈕，
agent 用 `show_contact_cards` 送出。按鈕的 postback 走 `draft:` 與 `contacted:` 前綴。

## 逾時預算：改動批次掃名片前一定要先看這段

Hobby 方案函式上限 **60 秒**，寫 `maxDuration = 300` 會被靜默忽略。

批次掃名片用 `lib/batch.ts` 的限流並行（`BATCH_CONCURRENCY = 3`）加時間預算
（`BATCH_DEADLINE_MS = 32_000`）。**deadline 只擋「還沒開始」的工作，不會中斷進行中的**，
所以預算必須抓在 60 秒減去「單張最久（約 15 秒）加收尾推播」。升級 Pro 後這兩個常數才能放寬。

超時的張數會明確回報給使用者（「N 張來不及處理，請再傳一次」），
不會像舊版那樣靜默消失。

## 事件去重

`lib/dedup.ts` 用 Firestore 的 `create()`（文件已存在就拋錯）做原子性認領，
擋掉 LINE 因回應太慢而重送整批事件造成的重複建檔。過期紀錄由每日 cron 清理。

**Firestore 出錯時故意 fail open**（照常處理），寧可偶爾重複也不要讓去重機制拖垮整個 bot。

## 圖文選單（2026-09-09）

LINE 底部的六格選單，讓常用功能不用打字。三個檔案綁在一起，改一個就要對照另外兩個：

| 檔案 | 負責 |
|---|---|
| `scripts/generate-richmenu.py` | 產底圖 `public/richmenu.png`（2500x1686，3 欄 2 列） |
| `lib/richmenu.ts` | 選單定義與上架流程（areas 座標、按鈕動作） |
| `app/api/admin/richmenu/route.ts` | 後台密碼保護的上架端點 |

**`CELLS` 的順序必須跟 `areas` 一一對應**（左上到右下），改了一邊沒改另一邊，使用者就會按到錯的功能。

重新上架（改完圖或按鈕後跑這個，會自動建立、上傳底圖、設為預設、刪掉舊選單）：

```
cd line-secretary
COOKIE=$(curl -s -i -X POST https://line-secretary-m6ji.vercel.app/api/admin/auth \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$(grep '^ADMIN_PASSWORD=' .env.local | cut -d= -f2- | tr -d '\"')\"}" \
  | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
curl -s -X POST https://line-secretary-m6ji.vercel.app/api/admin/richmenu -H "Cookie: $COOKIE"
```

底圖是用 HTTP 從 `public/richmenu.png` 抓的，不是用 fs 讀，因為 serverless 函式不保證讀得到 `public/` 下的檔案。所以**改圖一定要先部署再上架**，順序反了會傳到舊圖。

產圖字型的兩個坑：macOS 沒有 `PingFang.ttc`，中文要用 `/System/Library/Fonts/STHeiti Medium.ttc`；Apple Color Emoji 只吃固定點陣尺寸（20/32/40/48/64/96/160），其他尺寸會丟 `invalid pixel size`，所以固定用 160 算完再縮放。

按鈕分兩類：`message` 型送一句話給 agent 處理（需要查資料的用這個），`postback` 型在 webhook 的 `handlePostback` 直接回覆（`menu:scan`）或只用來叫出鍵盤預填文字（`menu:search`、`menu:expo`），後者省一次 agent 呼叫的費用與等待。

## 展場作戰包（2026-09-30，為 10/20-22 五金展而做）

設攤成本很高，但收完名片之後的轉換動作以前全是手工。這包把「收名片」接到「收單」。

**完整動線**：圖文選單 🎪 → 宣告場合 → 連續掃名片（語音隨手補註記）→ 說「收攤」→ 自動出戰果報告 → 批次起草跟進 → 匯出名單。

### 展場語音速記（`lib/expo-voice.ts`）

展場模式下傳語音，預設直接存成**最近那張名片**的筆記，不經過 agent。

分流規則刻意保守，因為**誤判代價不對稱**：筆記被當指令會直接遺失現場觀察而且你不會發現，指令被當筆記只是多一則垃圾筆記。所以只有整句明顯是指令才判為 command。加規則時請沿用這個原則，不要為了方便放寬成子字串比對（「找時間再約」不可以被當成搜尋指令）。

### 戰果報告（`lib/expo-report.ts`）

排序權重：名片評分 + 現場聊過 3 分 + DobBiz 潛力 2 分 + 有 Email 1 分。

**「現場留過語音筆記」給最高加權是刻意的**，那代表你真的停下來聊過，意願訊號比名片本身的評分更可信；單純路過拿名片不會有筆記。

### 批次起草（`lib/drafts.ts`）

一次 API 呼叫產出整批而不是一人一次，因為 Hobby 上限 60 秒，逐一呼叫五封就會逼近。一批固定 5 封（對齊 LINE 單次推播 5 則上限），續寫時 `skip` 往後加。

草稿會把現場筆記餵進去，所以講得出「你提到想找自動化」這種只有聊過才知道的細節，這是它跟罐頭開發信的差別。

### 名單匯出（`lib/csv.ts` + `uploadExportCsv`）

- `newsleopard`：電子豹匯入用，只收有 Email 的人
- `full`：完整備份，含筆記
- 分級 `A / B / C / BC / 全部`，**BC 是給「高分自己打電話、其餘丟 EDM」這個實際工作方式用的**

匯出檔含 64 人的手機與 Email，**不可以像名片圖那樣設成永久公開**，用的是 7 天到期的簽章網址、檔名帶隨機碼。簽章失敗時會降級成「請走後台匯出」而不是改成公開連結。

⚠️ `FIREBASE_STORAGE_BUCKET` 本機沒有，所以**匯出這條路徑無法在本機實測**，只能在正式環境驗。

## 測試檔的型別 import 坑

Node 的 `--experimental-strip-types` 不會把介面從值匯入清單裡移除，所以測試檔引用型別一定要分開寫：

```ts
import { buildExpoReport } from './expo-report.ts'
import type { ExpoContactLite } from './expo-report.ts'
```

混在一起會噴 `does not provide an export named 'ExpoContactLite'`，而且錯誤訊息看起來像模組壞掉，很容易誤判方向。

## 掃名片改版（2026-10-18，五金展前兩天）

改版前實測 110 筆正式資料，發現兩個真問題：

| 指標 | 數字 |
|---|---|
| 場合停在預設的「其他」 | 62／110（56%） |
| 名片原圖都有存 | 110／110 |

### 一張卡片取代四則訊息

以前掃一張名片會送出四則：分析中、結果加修正鈕、問場合、問服務項目，其中兩則還在等你回答。展場上每張名片要處理四次通知，根本用不下去。

現在是**一則確認加一張 Flex 卡片，零個必答問題**。服務項目追問整個拿掉（`setPendingNote` 已不再被呼叫，`consumePendingNote` 保留只為排掉改版前殘留的 pending）。

### 卡片放名片縮圖的理由

辨識錯誤真正的代價不是「會錯」，是**當下不知道它錯了**，等三週後要聯絡才發現名字是錯的。原圖擺在解析結果旁邊，錯誤當場看得出來。

因此 `scanCard` 的縮圖上傳從射後不理改成 `await`，多花一到兩秒換取可核對性。上傳失敗不擋建檔，卡片少一張圖照常顯示。

### OCR 自己標記沒把握的欄位

`CardData.uncertainFields` 由模型回報，卡片上用橘色警示區塊呈現，批次摘要則在該列尾端標 ⚠️。

prompt 裡寫明了判斷標準（罕見字、反光、摺痕、位數看不清等），並強調「辨識不準不是問題，不講出來才是問題」。改 prompt 時不要把這段拿掉。

### 場合未判定一定要顯示

56% 停在「其他」的根因是沒人告訴使用者「這張沒抓到場合」。卡片現在固定顯示場合列，沒判定出來就顯示「⚠️ 未判定，請按下方補」。

### 重疊行程取最晚開始的

`pickBestEvent` 同分時改取 `startMs` 較大的。

實例：10/21 早上全冠BNI會議 06:30-09:30 與五金展 08:00-18:00 重疊，改版前取清單第一個（先開始的 BNI），所以 08:00 到 09:30 掃的名片全部會被標成 BNI 會議。改成最晚開始後正確落在五金展。

反向案例也成立：展期中 14:00 的具體洽談仍會贏過整天的展覽，因為洽談才是認識對方的場合。

### 展場模式仍然值得開

場合判定現在夠穩了，但**語音速記只在展場模式下作用**，而那是攤位上最省時間的功能。每天開展前用圖文選單 🎪 開啟一次。

## 錯誤紀錄：出問題先讀這裡，不要靠猜（2026-10-29）

```
curl -s "https://line-secretary-m6ji.vercel.app/api/admin/errors?limit=10" -H "Cookie: $COOKIE"
```

`lib/error-log.ts` 把例外寫進 Firestore 的 `error_logs`，後台端點 `/api/admin/errors` 讀得到，保留 14 天，由每日 cron 清理。

**這支是 2026-10-29 事故的產物。** 掃名片回「發生錯誤」，但錯誤只進了 `console.error`，而 console 只有 Vercel 看得到。本機沒有正式環境的 LINE token（7/27 換 token 時只貼到 Vercel，沒寫回 `.env.local`，所以本機打 LINE API 一律 401），根本重現不了。整個下午在猜，就是因為沒有一個「正式環境的錯誤能讀回來」的管道。

`extra` 欄位刻意只放布林與計數（有沒有縮圖、幾個不確定欄位），不放姓名電話，因為這張表沒有名片那層的存取控管需求。

## 驗證新端點上線：401 不是就緒訊號（2026-10-29）

`middleware.ts` 的 matcher 是 `/api/admin/:path*`，**對這個前綴底下任何路徑都回 401，包含根本不存在的路徑**。所以「打新端點拿到 401 就代表部署好了」是錯的，建置失敗時一樣是 401。

正確做法是**看 `/api/admin/validate-flex` 回傳的 `commit` 欄位**（Vercel 自動注入的 `VERCEL_GIT_COMMIT_SHA` 前 7 碼），對得上你剛推的 commit 才算上線。

Next 16 的靜態路徑固定是 `_next/static/immutable/`，**沒有 per-build ID 可以比對**，別想用那招。

退而求其次的做法是帶有效 cookie 打新端點看是不是 404，但那只在「這次有新增端點」時管用；同一支端點改內容時兩版的回應會長得一樣，分不出新舊。2026-10-29 就是因為用 401 當訊號，誤判建置成功，實際上建置從頭就失敗（退路程式碼用了不存在的變數 `result`），正式環境跑的一直是舊程式碼。

順帶一提：`npx tsc --noEmit` 在這個 iCloud 專案要跑好幾分鐘，很容易想跳過。**push 之前一定要等它跑完**，Vercel 的建置會抓到同樣的錯，只是你要多等一輪部署才知道。

## 名片去重與合併（2026-10-29）

規則來自實測 113 筆資料，不是憑感覺訂的：

| 條件 | 動作 | 實測命中 |
|---|---|---|
| 姓名相同 ＋ 任一電話相同 | 自動合併，不問 | 4 組 |
| 手機相同 ＋ 姓名不同 | 卡片上給按鈕問使用者 | 4 組 |
| 只有公司電話相同 | 完全不處理 | 2 組，全部是誤判 |

**最後一條最重要。** 同公司不同人共用總機完全正常，實測那 2 組都是這種情況。把公司電話列入建議會產生永久性的誤判提示，使用者學會忽略提示之後，真正的重複也會被一起忽略掉。`lib/contact-merge.test.ts` 有一條測試專門擋這個，不要為了多抓幾組而放寬。

反過來，兩人共用手機幾乎不可能，所以手機撞號值得問。實測那 4 組裡有 2 組是 OCR 一字之差的同一人，另 2 組從資料上看不出來，所以設計成「建議」而不是自動。

### 為什麼先建檔再合併

`scanCard` 是先 `saveContact` 再呼叫 `mergeContactPair`，不是先查再決定要不要建檔。看起來多繞一步，但換到兩件事：

1. 合併邏輯只有一套（`planMerge`），有測試，不必再寫一條「不建檔」的分支
2. 被併掉的那筆是軟刪除，**所以那次的辨識結果會留著**。同一個人的名片掃兩次等於做了兩次獨立辨識，之後要核對名字對不對時，那是唯一的對照來源

### 合併的欄位規則

原則是**只補空缺，不覆蓋既有內容**，因為主檔可能已經被人工修正過（改過名字、調過評分、補過場合）。

- 主檔固定取建檔較早的那筆。實測 4 組自動重複，舊的那筆都有真實場合與一則筆記，新的那筆場合是「其他」且沒筆記
- 場合是「其他」等於沒判定出來，可以被真實場合蓋掉；反過來不行
- 狀態只能往前（待跟進 → 已聯絡 → 已提案 → 成交 → 引薦完成），不會被新掃的名片退回「待跟進」
- `score`、`category`、`followUpDays` 不參與合併，可能已人工調過
- 另一張名片原圖存進 `extraCardImages`

### 查詢一律走 fetchUserContacts

`lib/contact-service.ts` 的 `fetchUserContacts` 是唯一會掃整個 contacts 集合的地方，所有查詢都要經過它，因為它負責排除 `mergedInto` 有值的筆。**不要在別處自己寫 `where('lineUserId', ...)`**，漏掉一處就會有已合併的名片在某個畫面冒出來，而且很難查出是哪個查詢漏了。

用記憶體過濾而不是 `where('mergedInto', '==', null)`：Firestore 的 where 不會命中「欄位不存在」的文件（合併前建的名片都沒有這個欄位），而且加了就要建複合索引。

`getContactById` 會跟著 `mergedInto` 走一層，因為合併前送出的卡片還留在對話記錄裡，使用者幾天後翻上去按按鈕時要改到活著的那筆。

### 舊資料清理：卡片式，一組一張

`preview_duplicate_contacts` 送出 Flex carousel，一組重複一張卡片，上面兩顆按鈕：「🔗 合併成一筆」與「✋ 不是同一人」。

**第一版是回一段文字要使用者打「合併 1,2,5」，上線當天就被退回。** 編號跟人名的對應要自己在腦中維持，而且判斷錯了只能重打。一組一張卡片按完就結束，不用打字也不會對錯編號。

卡片上刻意先寫出「合併後保留上面那筆（場合：xxx），N 則筆記都留著」，因為不講清楚保留什麼，使用者不敢按。

**「不是同一人」一定要記住。** `dismissMergePair` 把配對寫進 `users/{id}.dismissedMergePairs`，`previewDuplicates` 會排除。不記的話每次檢查都再問同一組，被問第二次的提示等於沒有記憶，使用者會開始忽略所有提示，真正的重複也跟著被忽略。

配對鍵用 `pairKey`（兩個 id 排序後串接），**必須跟順序無關**：同一組在不同次盤點裡誰是 primary 可能因為資料被改過而互換，鍵跟順序有關就會再問第二次。

文字路徑仍然留著：`apply_duplicate_merges` 的 `selection` 可以傳 `auto`（只合併確定的）、`all`、或編號。卡片有 12 張上限，「合併確定的」一句話就能把確定的那幾組一次處理掉，比逐張按快。

合併都可以用 `undo_merge` 還原，被併掉的名片從來沒有真的被刪除。

### 改 Flex 卡片的規矩

**動到卡片就要在 `/api/admin/validate-flex` 加對應的案例，不是「部署後跑一次既有的驗證」。**

後者擋不住新增的分支。2026-10-29 出事的根因就是新卡片狀態沒被 LINE 驗過，而且十一天沒人碰到。同一天我加去重卡片時又差點重犯，所以能用測試守門的就寫測試（測試會跟著程式碼一起被迫更新），驗證端點是補那些測試驗不到的 LINE 規格。

## 還沒做的

行事曆改期與刪除、真正的「行程前 1 小時」即時推播（Hobby 的 cron 一天只能跑一次，
要做得接外部排程如 cron-job.org 打一支新端點）、業務知識庫（讓草稿引用真實服務與報價）。
