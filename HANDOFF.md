# HANDOFF · 接手指南（給新 session / 新 AI 同事）

> 這份檔案是「記憶外化」——讓新對話一開場讀完就能接手，不必重看舊對話。
> 搭配 `README.md`（架構/進度）一起看。最後更新：2026-06-09（對應 commit 在 `git log` 最上面）。

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

## 我的待辦（前端）
- **#24** 手機遠端的桌面管理 UI（token/QR/開關）— 等後端 #21/#22 伺服器先好
- （#7、#14 已完成關閉；#8 後端取消機制已完成；#25 Ctrl+Q 後端已修好）
- **#23 手機網頁客戶端 — ✅ 已完成**（見下）
- **#20 工作資料夾切換 UI — ✅ 完成**（已接後端 #18 真實 IPC，可端到端運作）

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
