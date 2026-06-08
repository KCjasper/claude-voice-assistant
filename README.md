# Voice Assistant · 本地語音 AI 助理

> 一個常駐桌面的液態玻璃浮窗，用語音指揮 AI 幫你處理工作 — Jarvis 風格的個人語音助理。

![status](https://img.shields.io/badge/status-MVP%20可用-brightgreen) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/Electron-42-9cf) ![gpu](https://img.shields.io/badge/Whisper-CUDA%20%E5%8A%A0%E9%80%9F-76b900)

## 這是什麼

桌面右下角的浮動小視窗，按熱鍵就能用講的下指令：寫稿、改檔案、查資料、上網搜尋、聊天。AI 處理完用語音念回給你聽。視覺採**液態玻璃 + 藍光**風格。

- 🎙 **按住熱鍵說話**（`Ctrl+Shift+Space`）— 喚醒詞「Hey Claude」規劃中
- ⚡ **GPU 加速語音辨識**（本地 Whisper + CUDA，辨識約 1 秒）
- 🧠 **真的會做事** — Claude 可讀寫你資料夾的檔案、上網搜尋、完成任務
- 🌊 **串流邊生成邊念** — 不用等整段講完，第一句就開始念
- 🔊 **多種語音** — 14 種中文 + 英式男聲（Jarvis 模式）+ ElevenLabs 真人級
- 🌐 **上網搜尋** — Tavily / Brave / Google 三選一
- 🪟 **兩種介面** — 常駐浮窗 + 全螢幕 Ops Center

## 系統架構

| 層 | 技術 | 說明 |
|---|---|---|
| 桌面外殼 | Electron + Windows Acrylic | 浮窗 / 全螢幕 / 設定三視窗，原生玻璃材質 |
| 語音輸入 | 本地 Whisper（whisper.cpp，CUDA 版） | 首次自動下載執行檔 + medium 模型，GPU 加速、離線辨識；失敗自動退回 CPU |
| 語音輸出 | Edge TTS（免費）/ ElevenLabs（真人級） | 可在設定切換引擎與音色 |
| AI 引擎 | Claw Router（OpenAI 相容） | `openai` SDK + 自寫串流 agent loop |
| 工具 | 檔案讀寫 / 列目錄 / 抓網頁 / web_search | 限工作資料夾內，搜尋走 Tavily/Brave/Google |
| 金鑰保管 | Electron `safeStorage` | 所有 key 系統加密儲存，不落明碼、不經聊天 |

## 開發進度

- [x] 階段 0：Electron 骨架 + 液態玻璃 UI（浮窗 / 全螢幕 / 設定）
- [x] 階段 1：設定頁 + API Key 加密儲存
- [x] 階段 2：錄音層（按住熱鍵說話）
- [x] 階段 3：本地 Whisper 語音轉文字
- [x] 階段 4：Edge TTS 語音輸出
- [x] 階段 5：接 Claw Router + 串流 agent loop（檔案 / 網頁工具）
- [x] 優化：Whisper GPU (CUDA) 加速、串流邊念
- [x] 語音：14 種中文 + 英式男聲 + Jarvis 模式 + ElevenLabs 真人級
- [x] web_search 工具（Tavily / Brave / Google）
- [ ] Jarvis 提示音效
- [ ] 「Hey Claude」喚醒詞
- [ ] 用量追蹤 + 月額上限自動斷線
- [ ] Ops Center 接真實資料
- [ ] Cowork 能力（Notion / 發推 MCP）

## 開發 / 執行

需要 [Node.js](https://nodejs.org/) 18+。GPU 加速需 NVIDIA 顯卡 + 新版驅動（會自動下載 CUDA 版 whisper；無 GPU 自動退回 CPU）。

```bash
cd app
npm install
npm start
```

首次使用：開啟後點浮窗的 ⚙ → 貼上 Claw Router API Key（`sk-...`）→ Test Connection。
（搜尋、ElevenLabs 等為選用，需各自在設定頁貼上對應 key。）

## 專案結構

```
voice-assistant/
├── plan.html            # 完整計畫書
├── ui-mockup.html       # UI 初版模型
├── ui-showcase.html     # UI 完整展示頁
└── app/
    ├── main.js          # Electron 主程序（視窗 / IPC）
    ├── preload.js       # 安全 IPC 橋
    ├── index.html …     # 浮窗 UI
    ├── fullscreen.* …   # 全螢幕 Ops Center
    ├── settings.* …     # 設定頁
    ├── tools/           # 開發用小工具（列模型等）
    └── src/
        ├── config/store.js   # 加密設定 / secret 儲存
        ├── audio/recorder.js # 麥克風錄音
        ├── stt/              # Whisper 自動安裝（CPU/GPU）+ 轉錄
        ├── tts/              # Edge TTS + ElevenLabs
        └── ai/               # 串流 agent loop + 工具 + 搜尋
```

## 安全須知

- 所有 API Key（Claw Router / 搜尋 / ElevenLabs）一律透過 app 設定頁輸入，以系統加密保存；**切勿**寫進程式碼或貼到任何聊天 / 文件。
- 檔案工具限制在工作資料夾內，防止路徑逃逸。
- 錄音檔僅存於本機暫存資料夾、用完即刪，不上傳。

## 授權

個人專案，保留所有權利（UNLICENSED）。

---

*KC 與 Claude Cowork 共同開發*
