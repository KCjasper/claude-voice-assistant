// app.js — 手機客戶端 UI 編排（協定 v1）
// 配對 → 錄 WAV → 客戶端編排 stt.transcribe → chat.send（progress 串流）→ 逐句 tts.synthesize → 播放。

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // 畫面
  const pairingScreen = $('pairingScreen');
  const assistantScreen = $('assistantScreen');
  // 配對
  const serverInput = $('serverInput');
  const tokenInput = $('tokenInput');
  const connectBtn = $('connectBtn');
  const scanBtn = $('scanBtn');
  const demoBtn = $('demoBtn');
  const pairingStatus = $('pairingStatus');
  const scanner = $('scanner');
  const scanVideo = $('scanVideo');
  const scanCancelBtn = $('scanCancelBtn');
  // 助理
  const connPill = $('connPill');
  const connText = $('connText');
  const usagePill = $('usagePill');
  const disconnectBtn = $('disconnectBtn');
  const orbZone = $('orbZone');
  const stateText = $('stateText');
  const stateDetail = $('stateDetail');
  const convo = $('convo');
  const micBtn = $('micBtn');
  const interruptBtn = $('interruptBtn');
  const dockSpacer = $('dockSpacer');
  const textToggleBtn = $('textToggleBtn');
  const textRow = $('textRow');
  const textInput = $('textInput');
  const ttsAudio = $('ttsAudio');

  const STORE_KEY = 'va-remote-pairing';
  const client = new RemoteClient();
  const recorder = new WavRecorder();
  recorder.onMaxReached = () => { if (recorder.isRecording()) stopRecording(); };

  let activeChatRequest = false;

  // ====================================================================
  function showScreen(which) {
    pairingScreen.classList.toggle('active', which === 'pairing');
    assistantScreen.classList.toggle('active', which === 'assistant');
  }
  function setPairingStatus(msg, kind) {
    pairingStatus.textContent = msg || '';
    pairingStatus.className = 'pairing-status' + (kind ? ' ' + kind : '');
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved.server) serverInput.value = saved.server;
  } catch {}

  function doConnect(server, token) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ server })); } catch {}
    unlockAudio();
    setPairingStatus('連線中⋯');
    connectBtn.disabled = true;
    // 先試既存 session token 重連（免重新配對）；沒有才用一次性 token
    const session = client.savedSessionFor(server);
    client.connect(server, token, { session });
  }

  connectBtn.addEventListener('click', () => {
    const server = serverInput.value.trim();
    const token = tokenInput.value.trim();
    if (!server) { setPairingStatus('請輸入桌面伺服器位址', 'error'); return; }
    const session = client.savedSessionFor(server);
    if (!token && !session) { setPairingStatus('請輸入配對碼（或掃 QR）', 'error'); return; }
    doConnect(server, token);
  });

  demoBtn.addEventListener('click', () => {
    unlockAudio();
    client.startMock();
    showScreen('assistant');
    clearConvo();
  });

  // ====================================================================
  // QR 掃描（BarcodeDetector）。配對 token 在 URL fragment：http://ip:port/#token=xxx
  // ====================================================================
  let scanStream = null, scanRAF = null, detector = null;
  scanBtn.addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) {
      setPairingStatus('此瀏覽器不支援掃描，請改用相機 App 掃 QR 後手動輸入', 'error');
      return;
    }
    try {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      scanVideo.srcObject = scanStream;
      await scanVideo.play();
      scanner.hidden = false;
      scanLoop();
    } catch (e) {
      setPairingStatus('無法開啟相機：' + e.message, 'error');
      stopScan();
    }
  });
  scanCancelBtn.addEventListener('click', stopScan);

  async function scanLoop() {
    if (!detector || scanner.hidden) return;
    try {
      const codes = await detector.detect(scanVideo);
      if (codes && codes.length) {
        const parsed = parsePairingPayload(codes[0].rawValue);
        if (parsed && parsed.server) {
          serverInput.value = parsed.server;
          if (parsed.token) tokenInput.value = parsed.token;
          stopScan();
          setPairingStatus('已讀取 QR，連線中⋯', 'ok');
          doConnect(parsed.server, parsed.token || '');
          return;
        }
      }
    } catch {}
    scanRAF = requestAnimationFrame(scanLoop);
  }

  // 後端 #22 的配對 URL：http://<lan-ip>:<port>/#token=<pairing>
  function parsePairingPayload(raw) {
    if (!raw) return null;
    try { const o = JSON.parse(raw); if (o.server || o.token) return o; } catch {}
    // 解析 http(s)/ws(s)://host:port/#token=... 或 ...?token=...
    const m = raw.match(/^(?:wss?|https?):\/\/([^/?#\s]+)/i);
    if (m) {
      const tok = (raw.match(/[#?&]token=([^&\s]+)/) || [])[1] || '';
      return { server: m[1], token: decodeURIComponent(tok) };
    }
    return null;
  }
  function stopScan() {
    scanner.hidden = true;
    if (scanRAF) cancelAnimationFrame(scanRAF);
    if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
    detector = null;
  }

  // ====================================================================
  // 狀態機
  // ====================================================================
  const STATE_TEXT = { idle: 'IDLE', listening: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING' };
  let currentState = 'idle';
  function renderState(state, detail) {
    currentState = state || 'idle';
    orbZone.className = 'orb-zone ' + currentState;
    stateText.textContent = STATE_TEXT[currentState] || currentState.toUpperCase();
    if (detail != null) stateDetail.textContent = detail;
    const busy = currentState === 'thinking' || currentState === 'speaking';
    interruptBtn.hidden = !busy;
    dockSpacer.hidden = busy;
  }

  // ====================================================================
  // 對話串
  // ====================================================================
  function clearConvo() { convo.innerHTML = ''; }
  function addBubble(role, text) {
    const el = document.createElement('div');
    if (role === 'tool') {
      el.className = 'bubble tool';
      el.textContent = '🔧 ' + text;
    } else {
      el.className = 'bubble ' + role;
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = role === 'you' ? '你說' : 'Claude';
      const body = document.createElement('div');
      body.textContent = text;
      el.appendChild(who); el.appendChild(body);
    }
    convo.appendChild(el);
    convo.scrollTop = convo.scrollHeight;
    return el;
  }
  let claudeBubble = null;
  function appendClaudeSentence(text) {
    if (!claudeBubble) claudeBubble = addBubble('claude', text);
    else {
      const body = claudeBubble.lastChild;
      body.textContent = (body.textContent ? body.textContent + ' ' : '') + text;
      convo.scrollTop = convo.scrollHeight;
    }
  }

  // ====================================================================
  // TTS 播放佇列（逐句 synthesize + 播放，pipeline）
  // ====================================================================
  const ttsQueue = [];
  let ttsRunning = false;
  function enqueueTtsSentence(text) {
    if (!text || client.mock) return;   // mock 不放真音
    ttsQueue.push(text);
    if (!ttsRunning) drainTts();
  }
  function clearTts() {
    ttsQueue.length = 0;
    try { ttsAudio.pause(); ttsAudio.currentTime = 0; } catch {}
    ttsRunning = false;
  }
  async function drainTts() {
    ttsRunning = true;
    while (ttsQueue.length) {
      const text = ttsQueue.shift();
      const res = await client.synthesize(text);
      if (res && res.ok && res.audioBase64) {
        if (currentState !== 'speaking') renderState('speaking', '');
        await playClip(res.audioBase64, res.format || 'mp3');
      }
    }
    ttsRunning = false;
  }
  function playClip(base64, format) {
    return new Promise((resolve) => {
      ttsAudio.src = `data:audio/${format};base64,${base64}`;
      ttsAudio.onended = ttsAudio.onerror = () => resolve();
      const p = ttsAudio.play();
      if (p && p.catch) p.catch(() => resolve());
    });
  }
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      ttsAudio.src = 'data:audio/mp3;base64,SUQzAwAAAAAAFlRTU0UAAAAMAAADTGF2ZjU4Ljc2AAA=';
      const p = ttsAudio.play();
      if (p && p.then) p.then(() => ttsAudio.pause()).catch(() => {});
      audioUnlocked = true;
    } catch {}
  }

  // ====================================================================
  // 一回合編排
  // ====================================================================
  const TOOL_LABELS = { read_file: '讀取檔案', write_file: '寫入檔案', list_directory: '查看資料夾', fetch_url: '查網路資料', web_search: '網路搜尋' };

  function onChatProgress(p) {
    if (!p) return;
    if (p.phase === 'sentence') {
      appendClaudeSentence(p.text);
      enqueueTtsSentence(p.text);
    } else if (p.phase === 'tool') {
      const label = TOOL_LABELS[p.name] || p.name;
      const target = p.args && (p.args.path || p.args.url) ? '：' + (p.args.path || p.args.url) : '';
      addBubble('tool', label + target);
      renderState('thinking', 'Claude 正在' + label);
    } else if (p.phase === 'thinking') {
      renderState('thinking', 'Claude 思考中⋯');
    }
  }

  async function runChat(text) {
    activeChatRequest = true;
    claudeBubble = null;
    clearTts();
    renderState('thinking', 'Claude 思考中⋯');
    const res = await client.chat(text, {}, onChatProgress);
    activeChatRequest = false;
    if (!res || !res.ok) { showChatError(res); return; }
    if (res.text && !claudeBubble) addBubble('claude', res.text);
    if (res.usageSummary) renderUsage(res.usageSummary);
    // 等 TTS 佇列播完才回 idle
    if (ttsRunning || ttsQueue.length) {
      const wait = setInterval(() => {
        if (!ttsRunning && !ttsQueue.length) { clearInterval(wait); renderState('idle', '✓ 完成'); }
      }, 150);
    } else {
      renderState('idle', '✓ 完成');
    }
  }

  function showChatError(res) {
    const map = {
      AI_BUSY: 'AI 正在處理上一個請求，稍等一下',
      MONTHLY_CAP_REACHED: '已達本月用量上限',
      MODEL_PRICE_UNKNOWN: '此模型無定價、無法控管上限',
      REMOTE_BUSY: '同時進行的請求太多，稍等一下',
      REMOTE_NOT_CONNECTED: '尚未連線',
      REMOTE_DISCONNECTED: '連線中斷了',
    };
    const code = res && res.code;
    renderState('idle', '⚠ ' + (map[code] || (res && res.error) || '發生錯誤'));
  }

  // ====================================================================
  // 錄音
  // ====================================================================
  async function startRecording() {
    if (recorder.isRecording()) return;
    try { await recorder.start(); }
    catch (e) { renderState('idle', '無法開啟麥克風：' + e.message); return; }
    micBtn.classList.add('recording');
    renderState('listening', '聆聽中⋯ 再按一次結束');
  }
  async function stopRecording() {
    if (!recorder.isRecording()) return;
    micBtn.classList.remove('recording');
    renderState('thinking', '處理錄音⋯');
    const wav = await recorder.stop();
    if (!wav || wav.byteLength <= 44) { renderState('idle', '錄音為空'); return; }
    const base64 = arrayBufferToBase64(wav);
    // 1) 辨識
    renderState('thinking', '辨識中⋯');
    const stt = await client.transcribe(base64, {}, (p) => {
      if (p && p.stage === 'model') renderState('thinking', '準備辨識模型⋯');
    });
    if (!stt || !stt.ok || !stt.text) {
      renderState('idle', stt && stt.error ? ('辨識失敗：' + stt.error) : '（沒聽清楚，再試一次）');
      return;
    }
    addBubble('you', stt.text);
    // 2) 對話（含逐句 TTS）
    await runChat(stt.text);
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  micBtn.addEventListener('click', () => {
    unlockAudio();
    if (currentState === 'thinking' || currentState === 'speaking') { doInterrupt(); return; }
    if (recorder.isRecording()) stopRecording();
    else startRecording();
  });

  function doInterrupt() {
    clearTts();
    client.interrupt();
    if (recorder.isRecording()) { recorder.stop().catch(() => {}); micBtn.classList.remove('recording'); }
    renderState('idle', '已中斷');
  }
  interruptBtn.addEventListener('click', doInterrupt);

  // ====================================================================
  // 打字輸入
  // ====================================================================
  textToggleBtn.addEventListener('click', () => {
    textRow.hidden = !textRow.hidden;
    if (!textRow.hidden) textInput.focus();
  });
  textRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    unlockAudio();
    addBubble('you', text);
    runChat(text);
    textInput.value = '';
  });

  // ====================================================================
  // 斷線
  // ====================================================================
  disconnectBtn.addEventListener('click', () => {
    clearTts();
    if (recorder.isRecording()) recorder.stop().catch(() => {});
    client.disconnect();
    showScreen('pairing');
    setPairingStatus('已斷線');
    connectBtn.disabled = false;
  });

  // ====================================================================
  // 用量條
  // ====================================================================
  function fmtMoney(n) {
    n = Number(n) || 0;
    return '$' + (n < 1 ? n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00') : n.toFixed(2));
  }
  function renderUsage(s) {
    if (!s || !s.today || !s.month) return;
    const cap = s.capUsd || 0;
    const capStr = cap > 0 ? ` / $${cap.toFixed(0)}` : '';
    usagePill.textContent = `今日 ${fmtMoney(s.today.usd)} · 本月 ${fmtMoney(s.month.usd)}${capStr}`;
    usagePill.classList.remove('warn', 'over');
    if (cap > 0) {
      if (s.overCap || s.month.usd >= cap) usagePill.classList.add('over');
      else if (s.month.usd >= cap * 0.8) usagePill.classList.add('warn');
    }
  }

  // ====================================================================
  // 連線層事件
  // ====================================================================
  client.on('status', ({ connected, detail }) => {
    connText.textContent = detail || (connected ? '已連線' : '未連線');
    connPill.classList.toggle('online', !!connected);
    connPill.classList.toggle('offline', !connected);
  });
  client.on('auth', ({ ok, error }) => {
    if (ok) {
      showScreen('assistant');
      clearConvo();
      renderState('idle', '已連線，按住下方按鈕說話');
      const host = (client.server || '').replace(/^wss?:\/\//, '');
      connText.textContent = host || '已連線';
      tokenInput.value = '';
    } else {
      connectBtn.disabled = false;
      // session 重連失敗 → 清掉，要求重新配對
      client.forgetSession();
      setPairingStatus(error || '配對失敗，請重新輸入配對碼', 'error');
    }
  });
  client.on('session', ({ session }) => {
    // 桌面 session 快照（可選用於顯示，目前用量已由 chat result 帶）
    if (session && session.usage && session.usage.todayUsd != null) {
      renderUsage({
        today: { usd: session.usage.todayUsd }, month: { usd: session.usage.monthUsd },
        capUsd: 0, enabled: false, overCap: false,
      });
    }
  });
  client.on('error', ({ message }) => {
    if (!pairingScreen.classList.contains('active')) renderState('idle', '⚠ ' + (message || '發生錯誤'));
  });
  client.on('closed', () => {
    if (!pairingScreen.classList.contains('active') && !client.mock) {
      // 連線掉了 → 回配對畫面
      showScreen('pairing');
      setPairingStatus('連線已中斷，請重新連線', 'error');
      connectBtn.disabled = false;
    }
  });

  // ====================================================================
  // 啟動：解析 QR 配對 URL（#28）
  //   桌面 QR = http://<host>:<port>/#token=<pairing>，本頁就是由那台
  //   server 供檔，所以 server 即 location.host。
  //   token 讀完立即從網址列清掉（避免留在歷史/截圖）；沒 token 但有
  //   既存 session token 也自動重連；都沒有才停在手動配對表單。
  // ====================================================================
  (function autoPairFromUrl() {
    showScreen('pairing');
    const tok = (location.hash.match(/[#&]token=([^&\s]+)/) || [])[1] || '';
    if (location.hash) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    }
    if (!/^https?:$/.test(location.protocol) || !location.host) return; // file:// 等情況走手動
    const server = location.host;
    const session = client.savedSessionFor(server);
    if (!tok && !session) return;
    serverInput.value = server;
    setPairingStatus(tok ? '已讀取 QR 配對碼，連線中⋯' : '使用既存連線憑證重連⋯', 'ok');
    doConnect(server, tok ? decodeURIComponent(tok) : '');
  })();
})();
