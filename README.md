# Voice Assistant · 本地語音 AI 助理

> 一個常駐桌面的液態玻璃浮窗，用語音指揮 AI 幫你處理工作 — Jarvis 風格的個人語音助理。

![status](https://img.shields.io/badge/status-WIP-orange) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/Electron-42-9cf)

## 這是什麼

桌面右下角的浮動小視窗，喊一聲或按熱鍵就能用講的下指令：寫稿、改檔案、查資料、聊天。AI 處理完用語音念回給你聽。視覺採**液態玻璃 + 藍光**風格。

- 🎙 **按住熱鍵說話**（`Ctrl+Shift+Space`）— 喚醒詞「Hey Claude」規劃中
- 🧠 **本地語音辨識**（Whisper，離線、免費、隱私佳）
- 🔊 **語音回覆**（Edge TTS，繁中女聲）
- 🌐 **多模型** — 透過 Claw Router 一個帳號用 Claude / GPT / Gemini 等
- 🪟 **兩種介面** — 常駐浮窗 + 全螢幕 Ops Center（看 AI 正在做什麼）

## 系統架構

| 層 | 技術 | 說明 |
|---|---|---|
| 桌面外殼 | Electron + Windows Acrylic | 浮窗 / 全螢幕 / 設定三視窗，原生玻璃材質 |
| 語音輸入 | 本地 Whisper（whisper.cpp） | 首次自動下載 medium 模型，之後離線辨識 |
| 語音輸出 | Edge TTS | 免費繁中語音合成 |
| AI 引擎 | Claw Router（OpenAI 相容）| `openai` SDK + 自寫 agent loop |
| 金鑰保管 | Electron `safeStorage` | API Key 以系統加密儲存，不落明碼 |

## 開發進度

- [x] 階段 0：Electron 骨架 + 液態玻璃 UI（浮窗 / 全螢幕 / 設定）
- [x] 階段 1：設定頁 + API Key 加密儲存
- [x] 階段 2：錄音層（按住熱鍵說話）
- [x] 階段 3：本地 Whisper 語音轉文字
- [ ] 階段 4：Edge TTS 語音輸出
- [ ] 階段 5：接 Claw Router + agent loop（檔案 / Bash / Web 工具）
- [ ] 階段 6：串通全流程 + 用量追蹤 + Ops Center 即時更新

## 開發 / 執行

需要 [Node.js](https://nodejs.org/) 18+。

```bash
cd app
npm install
npm start
```

首次使用：開啟後點浮窗的 ⚙ → 貼上 Claw Router API Key（`sk-...`）→ Test Connection。

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
    └── src/
        ├── config/store.js   # 加密設定儲存
        ├── audio/recorder.js # 麥克風錄音
        └── stt/              # Whisper 自動安裝 + 轉錄
```

## 安全須知

- API Key 一律透過 app 設定頁輸入，會以系統加密保存；**切勿**寫進程式碼或貼到任何聊天 / 文件。
- 錄音檔僅存於本機暫存資料夾，不上傳。

## 授權

個人專案，保留所有權利（UNLICENSED）。

---

*KC 與 Claude Cowork 共同開發*
