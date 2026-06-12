# HANDOFF · 接手指南（給新 session / 新 AI 同事）

> 這份檔案是「記憶外化」——讓新對話一開場讀完就能接手，不必重看舊對話。
> 搭配 `README.md`（架構/進度）一起看。最後更新：2026-06-13（對應 commit 在 `git log` 最上面）。

## 📍 專案位置（最重要，先確認）
- **本機路徑**：`D:\C槽使用者資料\Desktop\Claude-workspace\projects\voice-assistant`
  - git-bash 寫法：`/d/C槽使用者資料/Desktop/Claude-workspace/projects/voice-assistant`
  - 它是 Cowork 工作區 `Claude-workspace` 底下的 `projects/voice-assistant/`
- **app 程式在** `app/` 子資料夾（`cd app` 才能 `npm start` / `npm test`）
- GitHub：https://github.com/KCjasper/claude-voice-assistant（公開）
- 若本機沒有這個資料夾（全新環境）：`git clone` 上面網址，再 `cd app && npm install`
  （Whisper 執行檔與模型是首次執行時自動下載到 userData，不在 repo 內）

## 開場 60 秒要做的事
1. **`cd` 到上面的本機路徑**，讀這份 `HANDOFF.md` + `README.md`
2. `git fetch && git log --oneline -10`（看最近改了什麼）
3. `gh issue list --repo KCjasper/claude-voice-assistant`（看待辦與責任歸屬）
   - gh 已安裝且已登入（`C:\Program Files\GitHub CLI\gh.exe`，帳號 KCjasper）

## 我的角色 / 協作模式
- **我（KC + Claude）負責前端**：`renderer.js`、`fullscreen.*`、`settings.*`、`index.html`、樣式、UI/UX。issue 標 `frontend`。
- **AI 同事負責後端**：`main.js`、`src/`（引擎、用量、STT、工具、安全）。issue 標 `backend`。
- 新功能**先開 issue 並標清前後端**，各做各的；後端同事 UI/UX 不好，前端盡量留給我。
- `preload.js` 是前後端契約，改動要協調。
- 共用 `main` 分支：**嚴守 pull-before-push**（commit → `git pull --rebase` → push）。
- 回退用 `git revert`（**不要** `git reset --hard`，會跟同事的 push 打架）。
- 每次動工前先 `git fetch` + 看 issues。

## 開發 / 重啟流程（重要眉角）
- 啟動：`cd app && npm start`
- **重啟前一定要先殺掉現有 electron**（有單一實例鎖，不殺的話新版起不來、跑的還是舊版）：
  ```powershell
  Get-CimInstance Win32_Process -Filter "name='electron.exe'" |
    Where-Object { $_.CommandLine -like '*voice-assistant*' } |
    ForEach-Object { taskkill /PID $_.ProcessId /T /F }
  ```
- 改 `renderer/settings/fullscreen` 的 HTML/CSS/JS → 重開該視窗就生效；改 `main.js` 或 `src/` → 要完整重啟。
- 語法檢查 `node --check <file>`；測試 `npm test`（node:test）。
- 要實測需要 API key 的東西：在 `tools/` 寫一次性 electron 腳本，用 `.\node_modules\.bin\electron.cmd tools/x.js` 跑、結果寫到 temp 檔再讀，**跑完刪掉**（electron 主程序 console.log 在 Windows 看不到，所以寫檔）。

## 一定要知道的架構事實
- **AI 閘道 = Claw Router**（OpenAI 相容）。model id 是**裸的**：`claude-sonnet-4-6`、`claude-opus-4-8`、`gpt-5.5`、`gemini-3-pro-preview` 等，**沒有** `anthropic/` 前綴（用了會「無可用渠道」）。
- **用量已由後端接管**：`src/usage/ledger.js` + `policy.js`，`main.js` 的 `ai:chat` 自己記錄用量 + 擋月額上限。前端**只消費** `ai:chat` 回傳的 `res.usageSummary`，**不要**再加前端用量記錄（#6 已做）。被擋的 code：`MONTHLY_CAP_REACHED` / `MODEL_PRICE_UNKNOWN` / `AI_BUSY`。
- **串流用量不準**：Claw Router 串流回報 `prompt_tokens≈1`，`engine.js` 的 `reconcileUsage()` 用本地估算修正（成本為「約略」）。
- **工作資料夾鎖在 repo root**（後端 #2）。放寬到任意資料夾的功能規劃在 #18/#19/#20。
- **Ops Center 資料流**：浮窗 `renderer.js` 維護 `session` 物件，用 `window.api.pushSession(session)` → `main.js` 中繼 → 全螢幕 `fullscreen.js` 渲染。要改全螢幕顯示什麼，就改 `session` 內容 + `fullscreen.js`。
- **取消機制**：`src/tasks/cancellation.js`（後端 #8），signal 已接進 STT/TTS/工具。
- **TTS**：Edge（免費，14 中文 + 英式男聲）+ ElevenLabs（`prefs.ttsEngine='elevenlabs'`，走 v2 只列「我的聲音」）。KC 帳號有一個叫 **Jarvis** 的聲音。
- **金鑰**：全部走 `store.saveSecret`/`safeStorage` 加密，設定頁輸入，**絕不**經過聊天。

## 我的待辦（前端）— 2026-06-13 更新
- **🎨 Liquid Glass 全面改版進行中**（KC 指定的新設計語言，提示詞存於 `app/glass.css` 檔頭註解）：
  - ✅ 階段 1：`glass.css` 設計系統 + 浮窗 `styles.css` + 設定頁 `settings.css` 玻璃化（詳見下方日誌）
  - ✅ 階段 2：Ops Center 全螢幕 `fullscreen.*` 玻璃化（詳見下方日誌）
  - ⬜ 階段 3：手機客戶端 `app/mobile/styles.css` 對齊新設計語言
- **#26 喚醒詞設定 UI — ✅ 完成**（詳見下方日誌）
- **#27 Connector 設定與寫入確認 UI — ✅ 完成**（詳見下方日誌）

## 📒 工作日誌 · 🎨 Liquid Glass 改版階段 1（2026-06-13 完成）
> 給接手者：KC 不喜歡舊 UI，指定全面改成液態玻璃風格。設計提示詞（英文原文）在 `glass.css` 檔頭。

- **`app/glass.css`（新檔，共用設計系統）**：CSS 變數（墨色階 `--ink-*`、冰川藍 accent、玻璃材質層 `--glass-*`、邊緣光 `--edge*`、景深 `--depth`）+ `.glass-panel`（多層：scrim→玻璃→上緣鏡面掃光→內部柔光）+ `.glass-card` / `.lg-btn` / `.lg-input` + 共用動畫 `lg-breathe/pulse/spin/expand/wave/rise`。
- **浮窗 `styles.css`**：整面重寫成玻璃材質；Orb 改成水晶玻璃球（四態動畫沿用 class：`.assistant.idle/listening/thinking/speaking`）。
- **設定頁 `settings.css`**：全區段玻璃化（內凹玻璃輸入、膠囊玻璃按鈕、玻璃卡片）。
- **本 session 修掉的兩個視覺 bug**（瀏覽器 mock 預覽抓到）：
  1. `.ws-item-main` 是 `<button>` 沒 reset → 吃到 UA 灰白底變白條：補 `background:transparent;border:none;font:inherit` 等 reset。
  2. `input[type=range]`（說話速度、靈敏度）UA 白軌道：改自訂 `::-webkit-slider-runnable-track`（內凹玻璃）+ `::-webkit-slider-thumb`(玻璃拇指 + hover 放大)。
- **已驗證**：111/111 tests pass；`node --check` 過;瀏覽器 mock 預覽逐區段截圖確認（settings 全區段、浮窗 idle/listening）。
- **眉角**：HTML 引入順序必須 `glass.css` → 視窗自己的 css（變數在 glass.css 定義）。瀏覽器預覽 `renderer.js` 沒 `window.api` 會中斷屬既有行為，CSS 驗證不受影響。

## 📒 工作日誌 · 🎨 Liquid Glass 改版階段 2 — Ops Center（2026-06-13 完成）
> `fullscreen.css` 全面重寫成液態玻璃；`fullscreen.js` 完全沒動（class 名稱/狀態機全保留）。

- **`fullscreen.html`**：只加一行 `<link href="glass.css">`（必須在 fullscreen.css 之前）。
- **大 Orb**：實心藍球 → 水晶玻璃球（浮窗 Orb 放大版：透明內核 + 冰藍折射緣 + 雙高光點）。四態沿用 `body.idle/listening/thinking/speaking`：thinking 改成「玻璃球內部半透明 conic 折射光旋轉」（不再是實心紫藍 conic）；動畫全部改用 glass.css 的 `lg-*` keyframes。
- **面板**：左右兩片 `.panel` 改成浮動玻璃（scrim + 上緣鏡面高光 + 內部柔光 + `::before` 折射掃光層 + `--depth` 景深）。**刻意不用 backdrop-filter**：transparent Electron 視窗上會出黑塊（浮窗 `.assistant` 同理）。`.panel > *` 要 `z-index:1` 蓋過掃光層。
- **其餘**：topbar 按鈕/訊息卡/任務步驟/tool chips/kbd 鍵帽全部換玻璃材質；藍色系 `#60a5fa` 全面換成 glass.css 冰川藍變數。
- **已驗證**：瀏覽器預覽 mock 出對話/任務步驟/工具 chips，截圖確認 thinking + listening 兩態；`node --check` 不適用（純 CSS/HTML）。
- **眉角**：glass.css 沒被任何 HTML 用到 `.glass-panel` class——它是變數庫 + 公用 class 庫，各視窗 css 用同配方自己定義材質（因為各有 app-region / 佈局差異）。

## 📒 工作日誌 · #26 喚醒詞設定 UI（2026-06-13 完成）
> 給後端同事：設定頁加了 WAKE WORD 區段（VOICE 與 WEB SEARCH 之間），已接你 #12 的全部 IPC。

- **位置**：`settings.html` WAKE WORD 區段 + `settings.js` 的 `ww*` 區塊。
- **契約**：`getWakeWordState` / `listWakeWordDevices` / `setWakeWordConfig({wakeWordEnabled,sensitivity,deviceIndex})` / `setWakeWordAccessKey` / `clearWakeWordAccessKey` / `chooseWakeWordKeyword` / `retryWakeWord` / `onWakeWordState`。
- **UI**：啟用開關、狀態列（disabled/starting/listening/paused/fallback 對應狀態點顏色）、AccessKey 輸入（password + 顯示切換，走 secret store 絕不進 prefs）、麥克風下拉、靈敏度滑桿、自訂 .ppn 選擇、fallback 時明示「仍可用 Push-to-talk」+ 重試鈕。
- **降級**：`window.api.getWakeWordState` 不存在走預覽模式。

## 📒 工作日誌 · #27 Connector 設定與寫入確認 UI（2026-06-13 完成）
> 給後端同事：兩塊 — 設定頁 CONNECTORS 區段 + 浮窗確認卡，已接你 #15 的 IPC。

- **設定頁**：`settings.html` CONNECTORS 區段（REMOTE 與 SPENDING 之間）+ `settings.js` 的 `conn*` 區塊。`listConnectors()` 渲染清單（configured 狀態、tools/risk）；Notion token 只走 `setConnectorCredential('notion', token)`（不進 prefs、不回顯）；`clearConnectorCredential` / `checkConnectorHealth`（顯示 account 或 structured error）。
- **浮窗確認卡**：`index.html` 的 `#confirmStack` + `renderer.js` 確認卡區塊 + `styles.css` 的 `.confirm-*`。訂閱 `onConnectorEvent` 的 `confirmation-required`；視窗重開用 `getPendingConnectorConfirmations()` 重建。卡片顯示 connector/tool、title、parentPageId、contentPreview、TTL 倒數；**只有使用者顯式點「核准」**才呼叫 `approveConnectorAction(id)`，拒絕走 `rejectConnectorAction(id)`；處理 expired / `CONFIRMATION_NOT_FOUND`。內容一律 `textContent` 塞（防注入）。
- **降級**：無 `window.api` 時設定頁顯示預覽模式、浮窗確認卡不啟動。
- **#23 手機網頁客戶端 — ✅ 完成（已對齊協定 v1）**：客戶端在 **`app/mobile/`**（後端 server serve 此路徑）。詳見下方工作日誌。
  - ⚠️ 舊版 `mobile-client/`（假定協定）**已棄用**，被 `app/mobile/` 取代，待 KC 確認後可刪。
- **#24 手機遠端管理 UI — ✅ 完成**：設定頁 REMOTE 區段，已接 #21/#22 真實 IPC。詳見下方工作日誌。
- **新解鎖的前端機會**（後端 2026-06-11 一波交付）：
  - #10 熱鍵已可設定：`getPttHotkey`/`setPttHotkey`/`onPttHotkeyChanged` — 設定頁那行「暫時不可改」可以做成真 UI 了
  - #11 模型目錄：`listModels()` — MODEL 下拉可改吃動態清單
  - #12 喚醒詞服務：`wake-word:*` 一整組 IPC — 設定頁可加 Hey Claude 區段
  - #19 `onWorkspaceChanged` 廣播已做：#20 的 guard 自動生效；preload 還補了 `pickWorkspace`/`setWorkspace` alias
- （#7、#14、#25 已結；#20 完成；#23 UI 完成、連線層待對齊）

## 📒 工作日誌 · #10 可設定 Push-to-talk 熱鍵 UI（2026-06-12 完成）
> 給後端同事：設定頁 VOICE 區那行「暫時不可改」改成可錄製熱鍵，已接 hotkey IPC。

- **位置**：`settings.html` VOICE 區的熱鍵 field（顯示 + 「變更」鈕 + `hotkeyState` 狀態字）；`settings.js` 的 `hk*` 區塊。
- **契約**：`getPttHotkey()` / `setPttHotkey(acc)` → `{ ok, accelerator, registered, error }`；`onPttHotkeyChanged(cb)` 廣播。
- **互動**：點「變更」進入捕捉 → 監聽 `keydown`（capture phase + preventDefault）→ 轉成 Electron accelerator → `setPttHotkey`。Esc 取消。
- **轉換**：瀏覽器 keydown → accelerator：修飾鍵 Control/Alt/Shift/Super；主鍵支援字母/數字/Space/F1-24/方向鍵；**強制至少一個修飾鍵**（避免單鍵搶全域）；純修飾鍵 keydown 忽略等主鍵。
- **狀態**：`registered:true` 綠字「已生效」；`false` 紅字顯示 error（如與其他程式衝突）。`onPttHotkeyChanged` 廣播時更新（捕捉中不覆蓋）。
- **已驗證**：轉換多案例（Ctrl+Space、Ctrl+Alt+A、Shift+F2、無修飾鍵拒絕、純修飾鍵忽略）正確；完整捕捉互動（點變更→按 Ctrl+Shift+M→顯示更新）正常。
- **降級**：`window.api.getPttHotkey` 不存在時走預覽（顯示但不真註冊）。

## 📒 工作日誌 · #11 模型動態清單（2026-06-12 完成）
> 給後端同事：MODEL 下拉改吃 `listModels()` 動態清單，已對接。

- **位置**：`settings.html` MODEL 區段加「⟳ 更新」鈕 + `modelListStatus` 狀態字；`settings.js` 的 `mdl*` 區塊。
- **契約**：`listModels({force?})` → `{ ok, models:[{id, ownedBy, priceKnown, selectableUnderCap}], cached }`。
- **行為**：載入時若有 `listModels` 自動抓一次（保留目前 `defaultModel` 選中）；按「更新」帶 `force:true` 重抓。依 `ownedBy` 分 optgroup；`priceKnown:false` 標「（無定價）」；`selectableUnderCap:false`（月額上限開啟時無定價）→ option `disabled`。
- **fallback**：`window.api.listModels` 不存在或抓取失敗 → 保留 HTML 內建寫死清單，按鈕 disabled。
- **已驗證**：餵真實形狀樣本，分組/無定價標示/disabled/保留選中皆正確。

## 📒 工作日誌 · #24 手機遠端管理 UI（2026-06-12 完成）
> 給後端同事：設定頁加了 REMOTE 區段，已接你 #21/#22 的 IPC，以下是對接點。

- **位置**：`settings.html` 的 **REMOTE** 區段（WEB SEARCH 與 SPENDING 之間）+ `settings.js` 的 `rm*` 區塊 + `settings.css` 的 `.remote-*`。
- **用到的 IPC**（皆照你 preload 的）：`getRemoteStatus` / `getRemoteAccess` / `startRemote({})` / `stopRemote` / `rotateRemoteToken` / `startRemoteTunnel({acknowledgeRisk:true})` / `stopRemoteTunnel` / `onRemoteState` / `onRemoteTunnelState`。
- **渲染**：吃 `getRemoteAccess` 回的 `lan[].qrDataUrl`（直接塞 img）、`lan[].baseUrl`、`server.pairingToken`、`server.pairingConsumed`、`tunnel.status/publicUrl`、`warnings`。
- **互動**：開關啟用/停用伺服器；複製配對碼；重新產生配對碼；對外通道開關（開啟前 confirm 風險警告，帶 `acknowledgeRisk:true`）；`onRemoteState`/`onRemoteTunnelState` 廣播時自動重抓 access。
- **錯誤處理**：tunnel 啟動回 `REMOTE_TUNNEL_BINARY_MISSING` 時提示「找不到 cloudflared，請先安裝」。
- **已驗證**：mock 模式（瀏覽器預覽，無 window.api 時走假資料）驗證開關/QR/網址/配對碼/重新產生 UI 正常。真實 app 內 `window.api.getRemoteStatus` 存在即走真實 IPC。
- **優雅降級**：`window.api.getRemoteStatus` 不存在時走 mock 並顯示「後端遠端服務未連上」。

## 📒 工作日誌 · #23 手機客戶端對齊協定 v1（2026-06-12 完成）
> 給後端同事：客戶端已照你的 `app/src/remote/PROTOCOL.md` 完整對齊，以下是我這邊的實作重點。

- **位置**：`app/mobile/`（你的 `RemoteServer` staticDir 指這裡）。純靜態零 build。檔案：
  `index.html` / `styles.css` / `recorder.js`（WavRecorder）/ `remote.js`（RemoteClient）/ `app.js`（編排）/ `README.md`。
- **連線/認證**：`/ws?token=<配對碼>`；連上收 `auth.ready` 後把 `sessionToken` 存 localStorage，下次自動 `/ws?session=` 重連。
- **編排**（客戶端自己分請求，符合你的設計）：錄音→`stt.transcribe`(base64 WAV)→拿文字→`chat.send`（吃 `progress` 的 `phase:sentence/tool/thinking`）→每句 `tts.synthesize`→播放佇列。
- **音訊**：`WavRecorder` 產 16kHz mono RIFF/WAVE（移植自桌面 `recorder.js`）。iOS 不能自訂 AudioContext 取樣率 → 用原生取樣率錄、自己 resample 到 16k。
- **QR**：解析 `http://ip:port/#token=...`（fragment），對齊你 #22 的 `remote:get-access` 配對 URL 格式。
- **已驗證**：mock 模式跑完整一回合（你說→工具→串流兩句→用量更新）UI 正常。真實 WS 端到端要等 #24 的 UI 把 server 開起來 + 實機手機掃 QR。
- **棄用**：舊 `mobile-client/`（我先前照假定協定做的）已被 `app/mobile/` 取代，內容重複，建議刪除（等 KC 點頭）。

### 假定協定 → 真實協定 v1 對照（已全部改掉）
| 項目 | 舊假定（已棄） | 真實 v1（現行） |
|---|---|---|
| WS 路徑 | `/remote?token=X&v=1` | `/ws?token=<pairing>`，重連 `/ws?session=<session>` |
| 認證 | 連線後送 `hello` | token 在 URL；server 回 `auth.ready`（含 session token，已自存重連） |
| 配對 URL | query string | **fragment** `#token=...` |
| 訊息 | `{type:'audio'/'text'}` | 每訊息帶 `requestId`；`chat.send`/`stt.transcribe`/`tts.synthesize`/`request.cancel`/`interrupt`/`ping` |
| 音訊 | webm/opus | **WAV ≤8MB** |
| server 訊息 | state/sentence/tts/reply | `auth.ready`/`progress`/`result`/`session.state`/`pong`/`error` |
| 編排 | 後端一條龍 | 客戶端分請求；每連線最多 2 並發 |

## 🗂 工作資料夾切換 UI（#20，完成 2026-06-09）
- 位置：設定頁 `settings.html` 的 **WORKSPACE** 區段（在 MODEL 與 VOICE 之間）+ `settings.js` 的 workspace 區塊 + `settings.css` 的 `.ws-*` 樣式。
- 功能：顯示目前作用中路徑（含「預設專案資料夾」標示）、列出已授權資料夾（點一下切換、× 移除）、「選擇資料夾…」鈕、安全提示文字。
- **後端 #18 已交付 IPC**（preload `f781bfb`），前端已對齊**真實契約**（全部回 `{ ok, state }`）：
  - `getWorkspace()` / `chooseWorkspace()`（開原生對話框，取消回 `{canceled:true}`）/ `setActiveWorkspace(path)` / `removeWorkspace(path)`
  - `state = { workspaceDir, isDefault, approvedFolders:[{path,name}] }`；危險路徑後端 throw → `{ok:false,error,code}`
  - ⚠️ 方法名跟我原本假定的不同（`pick→choose`、`set→setActiveWorkspace`），已修正。`settings.js` 有 `wsUnwrap()` 把 `{ok,state}` 攤平成 `{active,folders,isDefault}`。
  - #19 規劃的 `workspace:changed` 廣播尚未做；`onWorkspaceChanged` 之後出現會自動接上（已留 guard）。
- **優雅降級 + mock**：`window.api.getWorkspace` 不存在時（如純瀏覽器預覽）自動走 mock 示範。

## 📱 手機遠端客戶端（#23，前端已完成 2026-06-09）
- 程式在**獨立資料夾** `mobile-client/`（**不在 `app/` 裡**）：純靜態、零 build、可直接部署 **Vercel**（KC 指定）。
- 檔案：`index.html`（配對+助理兩畫面）、`styles.css`（手機版液態玻璃，沿用桌面 Orb 四態）、
  `remote.js`（連線抽象層 `RemoteClient` + **mock 模式**）、`app.js`（錄音/TTS佇列/QR/iOS音訊解鎖）、
  `vercel.json`、`README.md`（含**假定 WS 協定**文件）。
- **前後端解耦**：等後端 #21 定 WS 協定，只改 `remote.js`，UI 不動。協定假定見 `mobile-client/README.md`，訊息名已對齊桌面 IPC。
- **本機預覽**：repo root 有 `.claude/launch.json`，或 `cd mobile-client && npx serve .`；按「先看看介面」走 mock 不需後端。
- ⚠ **混合內容**：Vercel 是 https，只能連 `wss://`；區網 `ws://` 由桌面內嵌 server 開這頁才行（細節見 README）。

## ⚠️ 待後端
- #23 真實連線等後端 **#21**（內嵌 server + WS 協定 + 認證）；對外 `wss` 等 **#22**（tunnel）。
- #25（Ctrl+Q 中斷）後端已於 `34657a5` 修好，且**動到了前端 `renderer.js`/`preload.js`/`index.html`**——前端再動這些檔前先 `git pull` 拿最新版。

## 取消機制（#8，後端已完成）
- preload 暴露：`cancelTask(target)`、`cancelAi(requestId)`、`cancelStt(requestId)`、`cancelTts(requestId)`
- 對應後端 IPC：`task:cancel` / `ai:cancel` / `stt:cancel` / `tts:cancel`；signal 已接進 STT/TTS/工具

## KC（使用者）偏好
- 用**繁體中文**溝通；不太懂技術，請白話解釋、不要丟一堆術語。
- 要安裝/下載東西前先說明是什麼、安不安全。
- 工作區 `Claude-workspace/_context/` 有 `about-me.md`、`lessons-learned.md`（每次對話會自動讀）。

## Repo
https://github.com/KCjasper/claude-voice-assistant（公開）

## Backend #10 - authoritative configurable push-to-talk hotkey (2026-06-11)
- Added `app/src/config/hotkey-manager.js` as the single owner of Electron global shortcut registration.
- Startup now reads `prefs.pttHotkey` instead of hard-coding `Control+Shift+Space`.
- Replacements register the new accelerator before unregistering the old one; conflicts keep the working shortcut and return `HOTKEY_REGISTRATION_FAILED`.
- Added `hotkey:get` / `hotkey:set`, preload methods, and `hotkey:changed` broadcasts for all live windows.
- `config:save-prefs` applies `pttHotkey` changes through the manager before persistence.
- Added startup/replacement/conflict/IPC/preload tests. No frontend UI files were changed.

## Backend #11 - provider model catalog and routing (2026-06-11)
- Added `app/src/ai/model-catalog.js` with provider `/models` fetching, five-minute caching, normalization, timeout handling, and pricing compatibility metadata.
- Added deterministic `fast` / `balanced` / `reasoning` routing when `prefs.modelRouting` is enabled.
- Routing validates provider availability when the catalog is reachable and falls back from unavailable or unknown-price models.
- With a spending cap enabled, unknown-price models are marked unavailable for automatic selection instead of failing later in the usage policy.
- Added `ai:list-models` / `window.api.listModels()` for frontend catalog consumption without changing frontend UI files.
- AI responses now include routing and catalog-fallback metadata. Added catalog, routing, fallback, cache, pricing, and preload tests.

## Backend #9 - spending reservations and paid TTS accounting (2026-06-11)
- Added `BudgetManager` reservations shared by AI and ElevenLabs requests so concurrent work cannot collectively exceed the remaining monthly cap.
- Added `maxAiRequestUsd` and `maxAiOutputTokens`; the AI engine converts the remaining dollar budget into a per-iteration `max_tokens` bound.
- Cost-bearing AI work is recorded even when a later tool-loop iteration stops at the request cost limit.
- The monthly cap now covers both AI and ElevenLabs. ElevenLabs reserves and records estimated cost using `elevenLabsCostPer1KCharsUsd`.
- Usage buckets now include character counts and per-provider cost/call metadata while preserving existing total fields.
- Failed and cancelled work releases reservations in `finally`; successful work reconciles to the authoritative usage ledger.
- Added concurrent reservation, release, cost-bound, provider metadata, Unicode character estimate, and migration-compatible ledger tests. No frontend UI files were changed.

## Backend #13 - backend-owned persistent sessions (2026-06-11)
- Added `SessionManager` with atomic `session.json` persistence, schema migration, retention, restart recovery, and multi-window broadcasts.
- Backend-generated turn IDs now own AI lifecycle state; renderer-provided IDs are retained only as correlation metadata.
- Completed user/assistant turns restore the AI engine history after restart. Tool arguments/results are never persisted.
- Ops Center snapshots are rebuilt from backend state. Renderer updates may only supplement idle/listening/speaking display state and cannot inject conversation history.
- Active work is marked interrupted after restart; reset clears both engine history and persisted session state.
- Added restart, migration-compatible persistence, retention, sanitization, multi-window, renderer-injection, and engine hydration tests. No frontend UI files were changed.

## Backend #12 - offline Hey Claude wake-word service (2026-06-11)
- Added a main-process Porcupine + PvRecorder service with local in-memory frame processing, device selection, sensitivity, lifecycle cleanup, and push-to-talk fallback states.
- Custom `Hey Claude` uses a platform-compatible `.ppn` file; the Picovoice AccessKey is stored through the encrypted secret store and is never placed in preferences or renderer state.
- Existing renderer session states pause wake capture during interaction/recording/playback and resume it when idle, preventing microphone and feedback conflicts without frontend changes.
- Added IPC for state, detection, device listing, configuration, encrypted AccessKey setup, keyword selection, and retry.
- Added service tests for detection, pause/resume, validation, device failures, capture failures, cleanup, and preload contracts. Audio frames are not persisted or uploaded.

## Backend #15 - connector registry and Notion integration (2026-06-11)
- Added a connector registry separate from local tools, with encrypted credential lifecycle, health checks, structured errors, cancellation, timeouts, events, and metadata-only JSONL auditing.
- Added `notion_search` as the first read-only vertical integration using Notion API version `2026-03-11`.
- Added `notion_create_page` behind a deduplicated, expiring, one-time confirmation boundary. AI tool calls can only queue the action; renderer approval executes it.
- Added connector IPC/preload contracts for list, credentials, health, pending confirmations, approve/reject, and event subscriptions.
- Added registry permission-policy, expiry, audit, Notion request/header/payload, and preload contract tests. Connector tokens and page body content are excluded from audit records.

## Backend #21 - embedded mobile HTTP/WebSocket server (2026-06-11)
- Added an opt-in main-process HTTP + `ws` server that serves `app/mobile` assets and bridges mobile chat, WAV transcription, TTS synthesis, interrupt, cancellation, progress, and authoritative session snapshots through the same desktop runtime.
- Added one-time 10-minute pairing tokens that exchange for hashed 24-hour session tokens. Tokens are memory-only; rotate/stop revokes sessions and disconnects clients.
- WebSocket upgrades require authentication and same-host browser origins. Direct traffic is restricted to private, link-local, or loopback addresses; static paths reject traversal, dotfiles, symlink escapes, and oversized files.
- Added per-client concurrency limits, 8 MB WAV validation, 20,000-character text limits, disconnect task cancellation, CSP/security headers, configurable port, lifecycle IPC, preload APIs, and protocol v1 documentation.
- Added real HTTP/WebSocket integration tests for 401 rejection, one-time pairing, reconnect, progress/results, session state, invalid audio, disconnect cancellation, token revocation, LAN address policy, IPC, and static serving. No mobile UI files were added.

## Backend #22 - LAN QR and optional Cloudflare tunnel (2026-06-11)
- Added deterministic private IPv4 discovery and `remote:get-access`, which returns LAN base URLs, fragment-based pairing URLs, and PNG QR data URLs. Pairing tokens stay out of HTTP request paths and query strings.
- Added an official `cloudflared` Quick Tunnel process manager with PATH/configured executable discovery, explicit risk acknowledgement, HTTPS URL parsing, startup timeout, duplicate-start coordination, cancellation, state events, and app/remote shutdown cleanup.
- Added `remote:start-tunnel`, `remote:stop-tunnel`, `getRemoteAccess`, `startRemoteTunnel`, `stopRemoteTunnel`, and `onRemoteTunnelState` backend/preload contracts. `stopRemote` always stops the public tunnel before disabling the local server.
- Public proxy browser origins are accepted only when the forwarded host arrives from a loopback socket. Pairing/session token authentication remains mandatory for WebSocket access.
- Added Cloudflare Quick Tunnel documentation and warnings: it is a development/testing service with no production SLA, the URL is Internet-accessible, and users must stop it after use. The backend does not download or bundle an unofficial tunnel binary.
- Added LAN selection, QR metadata, real QR generation, tunnel discovery/start/timeout/stop/race, trusted proxy-origin, IPC, preload, full backend regression, dependency audit, and Electron startup coverage. No frontend UI files were changed.
