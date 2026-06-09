// remote.js — 手機客戶端 ↔ 桌面伺服器的連線抽象層
//
// ⚠ 後端 (#21) 尚未定義正式 WS 協定。這裡先實作一份「假定協定」，
//   並抽成 RemoteClient，等後端定案只要改這支檔案、UI (app.js) 不用動。
//   假定協定見本資料夾 README.md 的「WS 協定」一節（已對齊桌面 IPC 事件名）。
//
// 對 app.js 暴露的事件（透過 on(event, cb)）：
//   'status'      { connected:boolean, detail:string }   連線層狀態
//   'auth'        { ok:boolean, error? }                  認證結果
//   'state'       { state, detail }                       助理狀態機 idle/listening/thinking/speaking
//   'transcript'  { text }                                STT 辨識出「你說的話」
//   'sentence'    { text }                                Claude 串流出的一句（文字）
//   'tts'         { audioBase64, format }                 該句的 TTS 音訊
//   'tool'        { name, target }                        Claude 正在用的工具
//   'reply'       { text }                                Claude 整段回覆（回合結束）
//   'usage'       { summary }                             權威用量摘要
//   'error'       { message, code? }
//
// app.js 呼叫的方法：
//   connect(server, token) / disconnect()
//   sendAudio(base64, mime) / sendText(text) / interrupt()

(function (global) {
  'use strict';

  const PROTOCOL_VERSION = 1;

  class RemoteClient {
    constructor() {
      this.ws = null;
      this.server = null;
      this.token = null;
      this.mock = false;
      this._handlers = {};
      this._reconnectTimer = null;
      this._intentionalClose = false;
    }

    on(event, cb) {
      (this._handlers[event] || (this._handlers[event] = [])).push(cb);
      return this;
    }
    _emit(event, payload) {
      (this._handlers[event] || []).forEach(cb => {
        try { cb(payload); } catch (e) { console.error('handler error', event, e); }
      });
    }

    // server 可為 "host:port"、"ws://..."、"wss://..."、"http(s)://..."
    _normalizeUrl(server, token) {
      let s = String(server || '').trim();
      if (!s) throw new Error('伺服器位址不可空白');
      // 已是 ws(s):// → 沿用；http(s):// → 換成對應 ws(s)
      if (/^wss?:\/\//i.test(s)) {
        // ok
      } else if (/^https:\/\//i.test(s)) {
        s = 'wss://' + s.slice('https://'.length);
      } else if (/^http:\/\//i.test(s)) {
        s = 'ws://' + s.slice('http://'.length);
      } else {
        // 裸 host:port — 若本頁是 https，預設用 wss 避免混合內容被擋
        const secure = (global.location && global.location.protocol === 'https:');
        s = (secure ? 'wss://' : 'ws://') + s;
      }
      // 接到 /remote 路徑 + token query（與假定協定一致）
      const u = new URL(s.replace(/\/+$/, '') + '/remote');
      if (token) u.searchParams.set('token', token);
      u.searchParams.set('v', String(PROTOCOL_VERSION));
      return u.toString();
    }

    connect(server, token) {
      this.disconnect(true);
      this._intentionalClose = false;
      this.server = server;
      this.token = token;
      this.mock = false;

      let url;
      try { url = this._normalizeUrl(server, token); }
      catch (e) { this._emit('error', { message: e.message }); return; }

      this._emit('status', { connected: false, detail: '連線中⋯' });
      let ws;
      try { ws = new WebSocket(url); }
      catch (e) { this._emit('error', { message: '無法建立連線：' + e.message }); return; }
      this.ws = ws;

      ws.onopen = () => {
        // 送 hello 帶 token 認證
        this._send({ type: 'hello', token, v: PROTOCOL_VERSION });
        this._emit('status', { connected: true, detail: '已連線，認證中⋯' });
      };
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onerror = () => {
        this._emit('error', { message: '連線發生錯誤' });
      };
      ws.onclose = (ev) => {
        this.ws = null;
        const reason = ev.reason || (ev.code === 1006 ? '連不到伺服器' : '連線已關閉');
        this._emit('status', { connected: false, detail: reason });
      };
    }

    _onMessage(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      switch (msg.type) {
        case 'auth':       this._emit('auth', msg); break;
        case 'state':      this._emit('state', msg); break;
        case 'transcript': this._emit('transcript', msg); break;
        case 'sentence':   this._emit('sentence', msg); break;
        case 'tts':        this._emit('tts', msg); break;
        case 'tool':       this._emit('tool', msg); break;
        case 'reply':      this._emit('reply', msg); break;
        case 'usage':      this._emit('usage', msg); break;
        case 'error':      this._emit('error', msg); break;
        case 'pong':       break;
        default:           console.warn('未知訊息類型', msg.type);
      }
    }

    _send(obj) {
      if (this.mock) { this._mockReceive(obj); return; }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      } else {
        this._emit('error', { message: '尚未連線，無法傳送' });
      }
    }

    sendAudio(base64, mime) { this._send({ type: 'audio', audioBase64: base64, mime: mime || 'audio/webm' }); }
    sendText(text)          { this._send({ type: 'text', text }); }
    interrupt()             { this._send({ type: 'interrupt' }); }

    disconnect(silent) {
      this._intentionalClose = true;
      clearTimeout(this._reconnectTimer);
      if (this.ws) {
        try { this.ws.close(1000, 'client disconnect'); } catch {}
        this.ws = null;
      }
      this.mock = false;
      if (!silent) this._emit('status', { connected: false, detail: '已斷線' });
    }

    // ===================================================================
    // Mock 模式：後端還沒好時，讓整個 UI 可離線示範 / 部署到 Vercel 也能展示
    // ===================================================================
    startMock() {
      this.disconnect(true);
      this.mock = true;
      this.server = '示範模式';
      setTimeout(() => {
        this._emit('status', { connected: true, detail: '示範模式（未連真實桌面）' });
        this._emit('auth', { ok: true });
        this._emit('state', { state: 'idle', detail: '按住下方按鈕說話（示範）' });
      }, 300);
    }

    _mockReceive(obj) {
      if (obj.type === 'interrupt') {
        clearTimeout(this._mockTimer);
        this._emit('state', { state: 'idle', detail: '已中斷（示範）' });
        return;
      }
      if (obj.type !== 'audio' && obj.type !== 'text') return;

      // 文字輸入：UI 已自行顯示「你說」泡泡，後端不會再回 transcript；
      // 語音輸入：後端做完 STT 才回 transcript（此時才知道你說了什麼）。
      const isAudio = obj.type === 'audio';
      const youText = isAudio ? '（示範語音）幫我看一下今天的待辦' : obj.text;
      const seq = [
        [200,  () => this._emit('state', { state: 'thinking', detail: isAudio ? '辨識中⋯' : 'Claude 思考中⋯' })],
        isAudio ? [600, () => this._emit('transcript', { text: youText })] : null,
        [900,  () => this._emit('state', { state: 'thinking', detail: 'Claude 思考中⋯' })],
        [1400, () => this._emit('tool', { name: 'list_directory', target: '/projects' })],
        [2100, () => { this._emit('state', { state: 'speaking', detail: '' });
                       this._emit('sentence', { text: '好的，我看了一下你的工作資料夾。' }); }],
        [3200, () => this._emit('sentence', { text: '目前有三個進行中的專案，要我幫你整理嗎？' })],
        [4200, () => {
          this._emit('reply', { text: '好的，我看了一下你的工作資料夾。目前有三個進行中的專案，要我幫你整理嗎？' });
          this._emit('usage', { summary: { today: { usd: 0.0123, calls: 4 }, month: { usd: 0.84 }, capUsd: 20, enabled: true, overCap: false } });
          this._emit('state', { state: 'idle', detail: '✓ 完成（示範）' });
        }],
      ];
      seq.filter(Boolean).forEach(([ms, fn]) => { this._mockTimer = setTimeout(fn, ms); });
    }
  }

  global.RemoteClient = RemoteClient;
})(window);
