# Voice Assistant · 本地語音 AI 助理

> 一個常駐桌面的液態玻璃浮窗，用語音指揮 AI 幫你處理工作 — Jarvis 風格的個人語音助理。

![status](https://img.shields.io/badge/status-MVP%20可用-brightgreen) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/Electron-42-9cf) ![gpu](https://img.shields.io/badge/Whisper-CUDA%20%E5%8A%A0%E9%80%9F-76b900) ![tests](https://img.shields.io/badge/tests-node:test-success)

## 這是什麼

桌面右下角的浮動小視窗，按熱鍵就能用講的下指令：寫稿、改檔案、查資料、上網搜尋、聊天。AI 處理完用語音念回給你聽。視覺採**液態玻璃 + 藍光**風格。

- 🎙 **按住熱鍵說話**（`Ctrl+Shift+Space`）— 喚醒詞「Hey Claude」規劃中
- ⚡ **GPU 加速語音辨識**（本地 Whisper + CUDA，辨識約 1 秒，無 GPU 自動退回 CPU）
- 🧠 **真的會做事** — Claude 可讀寫你資料夾的檔案、上網搜尋、完成任務
- 🌊 **串流邊生成邊念** — 不用等整段講完，第一句就開始念
- 🔊 **多種語音** — 14 種中文 + 英式男聲（Jarvis 模式）+ ElevenLabs 真人級
- 🌐 **上網搜尋** — Tavily / Brave / Google 三選一
- 📊 **用量追蹤** — 即時顯示今日 / 本月花費，月額上限由後端統一把關
- 🪟 **兩種介面** — 常駐浮窗 + 全螢幕 Ops Center（即時顯示對話 / 任務 / 工具 / 用量）

## 系統架構

| 層 | 技術 | 說明 |
|---|---|---|
| 桌面外殼 | Electron + Windows Acrylic | 浮窗 / 全螢幕 / 設定三視窗，原生玻璃材質 |
| 語音輸入 | 本地 Whisper（whisper.cpp，CUDA 版） | 首次自動下載執行檔 + medium 模型，GPU 加速、離線辨識；含逾時與自動退回 CPU |
| 語音輸出 | Edge TTS（免費）/ ElevenLabs（真人級） | 可在設定切換引擎與音色；ElevenLabs 走 v2 只列「我的聲音」 |
| AI 引擎 | Claw Router（OpenAI 相容） | `openai` SDK + 自寫串流 agent loop |
| 工具 | 檔案讀寫 / 列目錄 / 抓網頁 / web_search | 限工作資料夾內，搜尋走 Tavily/Brave/Google |
| 用量 / 上限 | 後端 ledger + policy + pricing | 用量記錄與月額上限由後端統一執行，前端只顯示權威摘要 |
| 金鑰保管 | Electron `safeStorage` | 所有 key 系統加密儲存，不落明碼、不經聊天 |

## 開發進度

**已完成**

- [x] Electron 骨架 + 液態玻璃 UI（浮窗 / 全螢幕 / 設定）
- [x] 設定頁 + API Key 加密儲存
- [x] 錄音層（按住熱鍵說話）
- [x] 本地 Whisper 語音轉文字（GPU/CUDA 加速、逾時、自動退回 CPU）
- [x] Edge TTS + ElevenLabs（v2「我的聲音」過濾）
- [x] 接 Claw Router + 串流 agent loop（檔案 / 網頁工具）
- [x] 串流邊生成邊念
- [x] 14 種中文 + 英式男聲 + Jarvis 模式
- [x] web_search 工具（Tavily / Brave / Google）
- [x] 用量追蹤 + 月額上限（後端 ledger/policy，前端顯示）
- [x] Ops Center 接真實資料（對話 / 任務 / 工具 / 用量即時同步）

**規劃中**（見 GitHub Issues）

- [ ] 工作資料夾切換（#18 後端 schema / #19 後端 picker / #20 前端 UI）
- [ ] 手機遠端使用（#21~#22 後端伺服器 / #23~#24 前端網頁客戶端與管理 UI）
- [ ] 「Hey Claude」喚醒詞（後端服務）
- [ ] 任務取消（AI / STT / TTS）
- [ ] Cowork 能力（Notion / 發推 MCP）

## 協作模式

本專案由 **KC + Claude（前端）** 與 **AI 同事（後端）** 共同開發，採 **issue 驅動**：

- **前端**（`renderer.js`、`fullscreen.*`、`settings.*`、UI/UX、樣式）→ 標 `frontend`
- **後端**（`main.js`、`src/` 邏輯、用量 / STT / 工具安全）→ 標 `backend`
- 新功能先開 issue 並標清前後端，各做各的；`preload.js` 為前後端契約，改動需協調
- 共用 `main` 分支，嚴守 **pull-before-push**；衝突用 `git revert`（不硬退）
- 每次動工前先 `git fetch` + 看 issues

## 開發 / 執行

需要 [Node.js](https://nodejs.org/) 18+。GPU 加速需 NVIDIA 顯卡 + 新版驅動。

```bash
cd app
npm install
npm start      # 啟動 app
npm test       # 跑後端 / 模組測試（node:test）
```

首次使用：開啟後點浮窗的 ⚙ → 貼上 Claw Router API Key → Test Connection。
（搜尋、ElevenLabs 等為選用，需各自在設定頁貼上對應 key。）

## 專案結構

```
voice-assistant/
├── plan.html / ui-mockup.html / ui-showcase.html   # 計畫書與 UI 展示
└── app/
    ├── main.js              # Electron 主程序（視窗 / IPC / 用量把關）
    ├── preload.js           # 安全 IPC 橋（前後端契約）
    ├── index.html · renderer.js · styles.css        # 浮窗 UI
    ├── fullscreen.*         # 全螢幕 Ops Center
    ├── settings.*           # 設定頁
    ├── usage-util.js        # 前端用量格式化
    ├── tools/               # 開發用小工具（列模型等）
    ├── test/                # node:test 測試
    └── src/
        ├── config/store.js  # 加密設定 / secret / 用量儲存
        ├── audio/recorder.js
        ├── stt/             # Whisper 自動安裝（CPU/GPU）+ 轉錄
        ├── tts/             # Edge TTS + ElevenLabs
        ├── ai/              # 串流 agent loop + 工具 + 搜尋 + pricing
        └── usage/           # 用量 ledger + 上限 policy
```

## 安全須知

- 所有 API Key（Claw Router / 搜尋 / ElevenLabs）一律透過 app 設定頁輸入，以系統加密保存；**切勿**寫進程式碼或貼到任何聊天 / 文件。
- 檔案工具限制在工作資料夾內，防止路徑逃逸。
- 錄音檔僅存於本機暫存資料夾、用完即刪，不上傳。
- 音效等第三方版權素材不納入 repo（見 `.gitignore`）。

## 授權

個人專案，保留所有權利（UNLICENSED）。

---

*KC 與 Claude Cowork（前端）+ AI 同事（後端）共同開發*
