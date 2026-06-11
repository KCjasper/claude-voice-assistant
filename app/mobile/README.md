# 手機遠端客戶端（app/mobile）

> Issue **#23**：手機網頁客戶端。已對齊後端 **協定 v1**（`app/src/remote/PROTOCOL.md`）。
> 純靜態、零 build。後端 (#21) 的內嵌 HTTP server 直接 serve 這個資料夾。

## 這是什麼

手機開網頁 → 輸入（或掃 QR）桌面伺服器位址 + 一次性配對碼 → 連上後用大麥克風鈕說話。
桌面端做 STT / Claude / TTS，結果即時回傳手機顯示與播放。桌面才是做事的，手機是薄客戶端。

## 檔案

| 檔案 | 作用 |
|---|---|
| `index.html` | 配對 + 助理兩畫面 |
| `styles.css` | 手機版液態玻璃（沿用桌面 Orb 四態） |
| `recorder.js` | `WavRecorder`：麥克風 → 16kHz mono **WAV**（含 iOS 原生取樣率 → resample） |
| `remote.js` | `RemoteClient`：WS 連線 + 協定 v1 + mock 模式 |
| `app.js` | UI 編排：配對 / 錄音 / 客戶端三段編排 / TTS 播放佇列 / QR 掃描 |

## 與後端協定 v1 的對接（已對齊）

- 連線：`ws(s)://host:port/ws?token=<配對碼>`；重連用 `?session=<sessionToken>`
- 連上後 server 送 `auth.ready`（含 24h `sessionToken`，已自動存 localStorage 供下次免配對重連）
- 每個請求帶唯一 `requestId`；server 以同 id 回 `progress` / `result`
- **客戶端自己編排一回合**：
  1. `stt.transcribe`（送 base64 WAV，≤8MB）→ 得辨識文字
  2. `chat.send`（送文字）→ `progress` 串流（`phase: sentence|tool|thinking`）+ `result`（完整回覆 + usageSummary）
  3. 每句 `tts.synthesize` → 得 `audioBase64` → 播放佇列
- 中斷 `interrupt`、取消 `request.cancel`、`ping`/`session.get` 亦支援
- 配對 token 走 URL **fragment**（QR 內容 `http://ip:port/#token=...`），不進 HTTP 路徑

> 若後端協定有變，**只改 `remote.js`**，UI 不動。

## 本機預覽（mock，不需後端）

```bash
cd app/mobile
npx serve .
```
開頁面按「先看看介面（離線示範）」即可走完整 mock 流程。

## 部署到 Vercel

這個資料夾即部署根目錄：Vercel **Root Directory** 設 `projects/voice-assistant/app/mobile`，Framework 選 **Other**，build/output 留空。

> ⚠ 混合內容：Vercel 是 https，只能連 `wss://`（需後端 #22 的 Cloudflare tunnel）。
> 區網 `ws://` 直連桌面時，由桌面內嵌 server 直接 serve 本資料夾最單純。
> `remote.js` 會依當前頁面協定自動選 `ws`/`wss`，位址三種格式皆可（`host:port` / `ws(s)://` / `http(s)://`）。

## iOS 注意

- 麥克風 WAV 走 Web Audio（`WavRecorder`），用裝置原生取樣率錄、resample 到 16k（iOS 不允許自訂 AudioContext 取樣率）。
- TTS 自動播放：已在首次手勢解鎖音訊；仍建議實機驗證。
