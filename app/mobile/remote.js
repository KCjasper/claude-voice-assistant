// remote.js — 手機客戶端 ↔ 桌面伺服器（對齊後端協定 v1，見 app/src/remote/PROTOCOL.md）
//
// 連線：wss?://host:port/ws?token=<pairing>  （重連用 ?session=<sessionToken>）
// 認證：token 在 URL，server 連上即回 auth.ready（含 sessionToken，需自存供重連）
// 每個 client 訊息都要唯一 requestId；server 以同一 requestId 回 progress / result。
//
// 客戶端「自己編排」一回合：stt.transcribe → chat.send（progress 串流）→ 對每句 tts.synthesize。
//
// 對 app.js 暴露的事件（on(event, cb)）：
//   'status'  { connected, detail }
//   'auth'    { ok, error?, sessionExpiresAt? }
//   'session' { session }                // 桌面 session 快照
//   'closed'  { code, reason }
// 高階方法（回 Promise<result>）：
//   transcribe(wavBase64, options?, onProgress?)  -> { ok, text, ... }
//   chat(text, options?, onProgress?)             -> { ok, text, usageSummary, model, ... }
//   synthesize(text, options?)                    -> { ok, audioBase64, ... }
//   interrupt() / cancel(targetRequestId) / ping()
// onProgress 收到後端 progress（對齊桌面：chat 的 {phase:'sentence'|'tool'|'thinking',...}、stt 的下載/辨識進度）。

(function (global) {
  'use strict';

  const PROTOCOL_VERSION = 1;
  const SESSION_KEY = 'va-remote-session';   // { server, sessionToken }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'r-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  class RemoteClient {
    constructor() {
      this.ws = null;
      this.server = null;
      this.sessionToken = null;
      this.mock = false;
      this._handlers = {};
      this._pending = new Map();   // requestId -> { resolve, onProgress, channel }
      this._authResolve = null;
    }

    on(event, cb) {
      (this._handlers[event] || (this._handlers[event] = [])).push(cb);
      return this;
    }
    _emit(event, payload) {
      (this._handlers[event] || []).forEach((cb) => { try { cb(payload); } catch (e) { console.error(e); } });
    }

    // server: "host:port" / "ws(s)://..." / "http(s)://..."；token 為一次性配對碼
    _buildUrl(server, { token, session }) {
      let s = String(server || '').trim();
      if (!s) throw new Error('伺服器位址不可空白');
      if (/^wss?:\/\//i.test(s)) { /* ok */ }
      else if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
      else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
      else {
        const secure = global.location && global.location.protocol === 'https:';
        s = (secure ? 'wss://' : 'ws://') + s;
      }
      const u = new URL(s.replace(/\/+$/, '') + '/ws');
      if (session) u.searchParams.set('session', session);
      else if (token) u.searchParams.set('token', token);
      return u.toString();
    }

    // 嘗試用既存 session token 重連（免重新配對）
    savedSessionFor(server) {
      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
        if (saved.server === server && saved.sessionToken) return saved.sessionToken;
      } catch {}
      return null;
    }

    connect(server, token, { session } = {}) {
      this.disconnect(true);
      this.mock = false;
      this.server = server;

      let url;
      try { url = this._buildUrl(server, { token, session }); }
      catch (e) { this._emit('auth', { ok: false, error: e.message }); return; }

      this._emit('status', { connected: false, detail: '連線中⋯' });
      let ws;
      try { ws = new WebSocket(url); }
      catch (e) { this._emit('auth', { ok: false, error: '無法建立連線：' + e.message }); return; }
      this.ws = ws;

      ws.onopen = () => this._emit('status', { connected: true, detail: '已連線，認證中⋯' });
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onerror = () => {};
      ws.onclose = (ev) => {
        this.ws = null;
        // 拒絕連線（401）通常是 token 失效
        if (ev.code === 1006 || ev.code === 4001) {
          this._emit('auth', { ok: false, error: ev.reason || '配對碼失效或連不到伺服器' });
        }
        this._failAllPending('連線已關閉');
        this._emit('closed', { code: ev.code, reason: ev.reason || '' });
        this._emit('status', { connected: false, detail: ev.reason || '連線已關閉' });
      };
    }

    _onMessage(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      switch (msg.type) {
        case 'auth.ready': {
          if (msg.sessionToken) {
            this.sessionToken = msg.sessionToken;
            try { localStorage.setItem(SESSION_KEY, JSON.stringify({ server: this.server, sessionToken: msg.sessionToken })); } catch {}
          }
          this._emit('auth', { ok: true, sessionExpiresAt: msg.sessionExpiresAt });
          break;
        }
        case 'progress': {
          const p = this._pending.get(msg.requestId);
          if (p && p.onProgress) { try { p.onProgress(msg.progress); } catch {} }
          break;
        }
        case 'result': {
          const p = this._pending.get(msg.requestId);
          if (p) { this._pending.delete(msg.requestId); p.resolve(msg.result); }
          break;
        }
        case 'session.state':
          this._emit('session', { session: msg.session });
          break;
        case 'pong': {
          const p = this._pending.get(msg.requestId);
          if (p) { this._pending.delete(msg.requestId); p.resolve({ ok: true, timestamp: msg.timestamp }); }
          break;
        }
        case 'error': {
          if (msg.requestId && this._pending.has(msg.requestId)) {
            const p = this._pending.get(msg.requestId);
            this._pending.delete(msg.requestId);
            p.resolve({ ok: false, code: msg.code, error: msg.error });
          } else {
            this._emit('error', { code: msg.code, message: msg.error });
          }
          break;
        }
        default: break;
      }
    }

    _failAllPending(reason) {
      for (const [, p] of this._pending) p.resolve({ ok: false, code: 'REMOTE_DISCONNECTED', error: reason });
      this._pending.clear();
    }

    // 送一個帶 requestId 的請求，回 Promise<result>
    _request(type, payload, onProgress) {
      if (this.mock) return this._mockRequest(type, payload, onProgress);
      return new Promise((resolve) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return resolve({ ok: false, code: 'REMOTE_NOT_CONNECTED', error: '尚未連線' });
        }
        const requestId = uuid();
        this._pending.set(requestId, { resolve, onProgress, channel: type });
        try { this.ws.send(JSON.stringify({ type, requestId, ...payload })); }
        catch (e) { this._pending.delete(requestId); resolve({ ok: false, error: e.message }); }
      });
    }

    transcribe(wavBase64, options = {}, onProgress) {
      return this._request('stt.transcribe', { audioBase64: wavBase64, options }, onProgress);
    }
    chat(text, options = {}, onProgress) {
      return this._request('chat.send', { text, options }, onProgress);
    }
    synthesize(text, options = {}) {
      return this._request('tts.synthesize', { text, options });
    }
    interrupt() { return this._request('interrupt', {}); }
    cancel(targetRequestId) { return this._request('request.cancel', { targetRequestId }); }
    ping() { return this._request('ping', {}); }

    disconnect(silent) {
      this._failAllPending('已斷線');
      if (this.ws) { try { this.ws.close(1000, 'client disconnect'); } catch {} this.ws = null; }
      this.mock = false;
      if (!silent) this._emit('status', { connected: false, detail: '已斷線' });
    }

    forgetSession() {
      this.sessionToken = null;
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    }

    // ===================================================================
    // Mock 模式：離線示範 / Vercel 展示（不連真實桌面）
    // ===================================================================
    startMock() {
      this.disconnect(true);
      this.mock = true;
      this.server = '示範模式';
      setTimeout(() => {
        this._emit('status', { connected: true, detail: '示範模式（未連真實桌面）' });
        this._emit('auth', { ok: true });
      }, 250);
    }

    _mockRequest(type, payload, onProgress) {
      return new Promise((resolve) => {
        if (type === 'stt.transcribe') {
          setTimeout(() => resolve({ ok: true, text: '幫我看一下今天的待辦' }), 700);
        } else if (type === 'chat.send') {
          const text = payload.text || '';
          setTimeout(() => onProgress && onProgress({ phase: 'thinking' }), 200);
          setTimeout(() => onProgress && onProgress({ phase: 'tool', name: 'list_directory', args: { path: '/projects' } }), 800);
          setTimeout(() => onProgress && onProgress({ phase: 'sentence', text: '好的，我看了一下你的工作資料夾。' }), 1500);
          setTimeout(() => onProgress && onProgress({ phase: 'sentence', text: '目前有三個進行中的專案，要我幫你整理嗎？' }), 2600);
          setTimeout(() => resolve({
            ok: true,
            text: (text ? '' : '') + '好的，我看了一下你的工作資料夾。目前有三個進行中的專案，要我幫你整理嗎？',
            model: 'claude-opus-4-8',
            usageSummary: { today: { usd: 0.0123, calls: 4 }, month: { usd: 0.84 }, capUsd: 20, enabled: true, overCap: false },
          }), 3400);
        } else if (type === 'tts.synthesize') {
          setTimeout(() => resolve({ ok: true, audioBase64: '' }), 200);  // 示範不放真的音
        } else {
          setTimeout(() => resolve({ ok: true }), 100);
        }
      });
    }
  }

  global.RemoteClient = RemoteClient;
  global.REMOTE_PROTOCOL_VERSION = PROTOCOL_VERSION;
})(window);
