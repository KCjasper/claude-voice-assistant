# 手機遠端客戶端（mobile-client）

> Issue **#23**：手機網頁客戶端 UI。讓 KC 在手機上操作跑在桌面的語音助理。
> 純靜態前端，**零 build**，可直接部署到 Vercel。

## 這是什麼

手機開網頁 → 輸入（或掃 QR）桌面伺服器位址 + 一次性配對碼 → 連上後，
用大麥克風鈕說話，桌面端做 STT / Claude / TTS，結果即時回傳到手機顯示與播放。

桌面才是真正做事的（檔案、GPU Whisper、API 金鑰）；手機只是薄客戶端。

## 檔案

| 檔案 | 作用 |
|---|---|
| `index.html` | 兩個畫面：配對 + 助理 |
| `styles.css` | 液態玻璃 + 藍光，手機直向優化（沿用桌面 Orb 四態動畫） |
| `remote.js` | **連線抽象層** `RemoteClient`：WS 連線 + 假定協定 + mock 模式 |
| `app.js` | UI 編排：配對、MediaRecorder 錄音、TTS 播放佇列、QR 掃描、iOS 音訊解鎖 |
| `vercel.json` | 靜態部署設定（cleanUrls + 安全標頭 + 相機/麥克風權限） |

前端與連線層解耦：等後端 WS 協定定案，**只需改 `remote.js`**，`app.js` / UI 不用動。

## 本機預覽

任何靜態伺服器即可（麥克風 / 相機需要 https 或 localhost）：

```bash
cd mobile-client
npx serve .        # 或 python -m http.server 5500
```

開 `http://localhost:xxxx`，按「先看看介面（離線示範）」即可看完整流程（mock 模式，不需後端）。

## 部署到 Vercel

這個資料夾就是部署根目錄：

- Vercel 專案 **Root Directory** 設成 `mobile-client`
- Framework Preset：**Other**（無 build，直接出靜態檔）
- Build Command 留空、Output Directory 留空

> ⚠ **混合內容注意**：Vercel 是 HTTPS。HTTPS 頁面只能連 `wss://`，連不安全的 `ws://<區網IP>` 會被瀏覽器擋。
> - 區網直連桌面（`ws://`）→ 適合「從桌面內嵌 HTTP server 開這頁」(原 #21 模式)。
> - Vercel 託管這頁 → 桌面端需提供 `wss://`（後端 #22 的 tunnel，如 Cloudflare Tunnel / ngrok）。
>
> 客戶端兩種都支援：伺服器位址可填 `host:port`、`ws(s)://...`、`http(s)://...`，`remote.js` 會自動正規化。

---

## WS 協定（假定 v1 — 待後端 #21 對齊）

> 後端 #21 把「定義並文件化 WS 協定」列為其工作。在那之前，客戶端先用以下假定協定
> （訊息名稱刻意對齊桌面 `preload.js` / `renderer.js` 的 IPC 事件，降低後端橋接成本）。
> 後端定案後，回來改 `remote.js` 的 `_onMessage` / `_send` 即可。

### 連線與認證

- 連線 URL：`wss://<host>/remote?token=<一次性碼>&v=1`
- 連上後 client 立即送：`{ "type": "hello", "token": "...", "v": 1 }`
- server 回：`{ "type": "auth", "ok": true }` 或 `{ "type": "auth", "ok": false, "error": "配對碼錯誤" }`
- 未認證的連線一律拒絕（對齊 #21 安全要求）。

### client → server

| type | 欄位 | 說明 |
|---|---|---|
| `hello` | `token`, `v` | 連上後認證 |
| `audio` | `audioBase64`, `mime` | 上傳麥克風錄音（MediaRecorder，通常 `audio/webm;codecs=opus`），由桌面做 STT→Claude→TTS |
| `text` | `text` | 直接送文字對話（略過 STT） |
| `interrupt` | — | 中斷目前生成 / 播放（對應桌面 `app:interrupt`） |

### server → client

| type | 欄位 | 對應桌面事件 |
|---|---|---|
| `auth` | `ok`, `error?` | — |
| `state` | `state`(idle\|listening\|thinking\|speaking), `detail` | `renderer` 狀態機 |
| `transcript` | `text` | STT 結果（你說的話） |
| `tool` | `name`, `target?` | `ai:progress` phase=tool |
| `sentence` | `text` | `ai:progress` phase=sentence（串流逐句文字） |
| `tts` | `audioBase64`, `format`(mp3) | 該句的 TTS 音訊（與 sentence 配對逐句播） |
| `reply` | `text` | 整段回覆，回合結束（沒串流時用來補整段） |
| `usage` | `summary` | `res.usageSummary`：`{ today:{usd,calls}, month:{usd}, capUsd, enabled, overCap }` |
| `error` | `message`, `code?` | code 同後端：`AI_BUSY` / `MONTHLY_CAP_REACHED` / `MODEL_PRICE_UNKNOWN` |

### QR 內容格式（給後端 #22 產 QR 時對齊）

`remote.js` 的 `parsePairingPayload` 接受兩種：

- JSON：`{"server":"192.168.0.12:8765","token":"abc123"}`
- URL ：`va://192.168.0.12:8765?token=abc123`（或 `ws(s)`/`http(s)` 開頭）

---

## 還沒做 / 待後端

- 真實 WS 連線目前只能對「假定協定」；後端 #21 定案後對齊。
- 對外 `wss://` 通道（#22）。
- iOS Safari 音訊自動播放：已用「首次手勢解鎖」處理，仍建議實機驗證。
