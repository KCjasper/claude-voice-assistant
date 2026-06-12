# Voice Assistant · 本地語音 AI 助理

> 一個常駐桌面的液態玻璃浮窗，用語音指揮 AI 幫你處理工作 — Jarvis 風格的個人語音助理。

![status](https://img.shields.io/badge/status-功能完成-brightgreen) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/Electron-42-9cf) ![gpu](https://img.shields.io/badge/Whisper-CUDA%20%E5%8A%A0%E9%80%9F-76b900) ![tests](https://img.shields.io/badge/tests-node:test-success)

## 這是什麼

桌面右下角的浮動小視窗，按熱鍵或喊「Hey Claude」就能用講的下指令：寫稿、改檔案、查資料、上網搜尋、聊天。AI 處理完用語音念回給你聽。視覺採**液態玻璃**風格（冰川藍）。

- 🎙 **語音喚醒** — 按住熱鍵（可自訂）說話，或離線喚醒詞「Hey Claude」
- ⚡ **GPU 加速語音辨識**（本地 Whisper + CUDA，辨識約 1 秒，無 GPU 自動退回 CPU）
- 🧠 **真的會做事** — Claude 可讀寫你資料夾的檔案、上網搜尋、完成任務，任務隨時可中斷
- 🌊 **串流邊生成邊念** — 不用等整段講完，第一句就開始念
- 🔊 **多種語音** — 14 種中文 + 英式男聲（Jarvis 模式）+ ElevenLabs 真人級
- 🌐 **上網搜尋** — Tavily / Brave / Google 三選一
- 🗂 **可切換工作資料夾** — 限定 AI 能讀寫的範圍，安全把關
- 📱 **手機遠端** — 手機掃 QR 連上桌面，隨身用（區網直連或可選對外通道）
- 🔌 **外部服務 connector** — Notion（寫入動作需逐次確認，不自動執行）
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
| 喚醒詞 | Porcupine（離線） | 「Hey Claude」本機偵測，麥克風只在記憶體處理、不上傳 |
| 手機遠端 | 內嵌 HTTP + WebSocket + QR | 手機網頁客戶端，配對碼認證，可選 Cloudflare 對外通道 |
| 外部服務 | Connector registry（Notion） | 讀取直接做，寫入需使用者逐次確認 |
| 用量 / 上限 | 後端 ledger + policy + pricing | 用量記錄與月額上限由後端統一執行，前端只顯示權威摘要 |
| 金鑰保管 | Electron `safeStorage` | 所有 key 系統加密儲存，不落明碼、不經聊天 |

## 開發進度

**規劃功能全部完成** — GitHub Issues #1–#27 全數結案。

- [x] Electron 骨架 + 液態玻璃 UI（浮窗 / 全螢幕 / 設定）
- [x] 設定頁 + API Key 加密儲存
- [x] 錄音層 + 可設定的 Push-to-talk 熱鍵
- [x] 本地 Whisper 語音轉文字（GPU/CUDA 加速、逾時、自動退回 CPU）
- [x] 「Hey Claude」離線喚醒詞
- [x] Edge TTS + ElevenLabs（v2「我的聲音」過濾）
- [x] 接 Claw Router + 串流 agent loop（檔案 / 網頁 / 搜尋工具）
- [x] 串流邊生成邊念 + 14 種中文 + 英式男聲 + Jarvis 模式
- [x] 任務中斷（AI / STT / TTS）
- [x] web_search 工具（Tavily / Brave / Google）
- [x] 用量追蹤 + 月額上限（後端 ledger/policy，前端顯示）
- [x] Ops Center 接真實資料（對話 / 任務 / 工具 / 用量即時同步）
- [x] 工作資料夾切換 + 安全模型
- [x] 手機遠端（內嵌 server + QR + 桌面管理 UI + 手機網頁客戶端）
- [x] 外部服務 connector（Notion，寫入逐次確認）

> 程式碼與單元測試（111 項）已完整覆蓋；手機遠端與喚醒詞的「實機端到端」smoke test 待實際設備驗證。

## 架構分工

`main.js` / `preload.js`（前後端契約）/ `src/` 為核心邏輯（用量、STT、工具安全），UI 在 `renderer.js`、`fullscreen.*`、`settings.*`。檔案工具一律受 `src/config` 的工作資料夾安全模型約束。

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
└── app/
    ├── main.js              # Electron 主程序（視窗 / IPC / 用量把關）
    ├── preload.js           # 安全 IPC 橋（前後端契約）
    ├── glass.css            # 液態玻璃共用設計系統
    ├── index.html · renderer.js · styles.css        # 浮窗 UI
    ├── fullscreen.*         # 全螢幕 Ops Center
    ├── settings.*           # 設定頁
    ├── mobile/              # 手機遠端網頁客戶端（純靜態，後端 server 供檔）
    ├── usage-util.js        # 前端用量格式化
    ├── test/                # node:test 測試
    └── src/
        ├── config/          # 加密設定 / secret / 熱鍵 / 工作資料夾安全模型
        ├── audio/           # 錄音 + 播放佇列
        ├── stt/             # Whisper 自動安裝（CPU/GPU）+ 轉錄
        ├── tts/             # Edge TTS + ElevenLabs
        ├── ai/              # 串流 agent loop + 工具 + 搜尋 + pricing
        ├── usage/           # 用量 ledger + 上限 policy
        ├── wake-word/       # Hey Claude 離線喚醒詞服務
        ├── remote/          # 內嵌 HTTP/WS server + QR + 對外通道
        ├── connectors/      # 外部服務 registry（Notion）
        ├── session/         # 後端權威對話 / Ops Center 狀態
        └── tasks/           # 任務取消 / 中斷
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
