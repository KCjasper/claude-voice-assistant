// app.js — 手機客戶端 UI 編排
// 配對 → 錄音上傳 → 渲染助理狀態 → 播放 TTS。連線細節都在 remote.js。

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ===== 畫面 =====
  const pairingScreen = $('pairingScreen');
  const assistantScreen = $('assistantScreen');
  // ===== 配對 =====
  const serverInput = $('serverInput');
  const tokenInput = $('tokenInput');
  const connectBtn = $('connectBtn');
  const scanBtn = $('scanBtn');
  const demoBtn = $('demoBtn');
  const pairingStatus = $('pairingStatus');
  const scanner = $('scanner');
  const scanVideo = $('scanVideo');
  const scanCancelBtn = $('scanCancelBtn');
  // ===== 助理 =====
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

  // ====================================================================
  // 畫面切換
  // ====================================================================
  function showScreen(which) {
    pairingScreen.classList.toggle('active', which === 'pairing');
    assistantScreen.classList.toggle('active', which === 'assistant');
  }

  // ====================================================================
  // 配對流程
  // ====================================================================
  function setPairingStatus(msg, kind) {
    pairingStatus.textContent = msg || '';
    pairingStatus.className = 'pairing-status' + (kind ? ' ' + kind : '');
  }

  // 還原上次輸入（不存 token，token 是一次性的）
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved.server) serverInput.value = saved.server;
  } catch {}

  connectBtn.addEventListener('click', () => {
    const server = serverInput.value.trim();
    const token = tokenInput.value.trim();
    if (!server) { setPairingStatus('請輸入桌面伺服器位址', 'error'); return; }
    if (!token) { setPairingStatus('請輸入配對碼', 'error'); return; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ server })); } catch {}
    unlockAudio();
    setPairingStatus('連線中⋯');
    connectBtn.disabled = true;
    client.connect(server, token);
  });

  demoBtn.addEventListener('click', () => {
    unlockAudio();
    client.startMock();
    showScreen('assistant');
    clearConvo();
  });

  // ====================================================================
  // QR 掃描（用瀏覽器內建 BarcodeDetector；不支援則提示手動輸入）
  // QR 內容假定為 JSON：{"server":"192.168.0.12:8765","token":"abc123"}
  //                或純文字 "va://192.168.0.12:8765?token=abc123"
  // ====================================================================
  let scanStream = null, scanRAF = null, detector = null;

  scanBtn.addEventListener('click', async () => {
    if (!('BarcodeDetector' in window)) {
      setPairingStatus('此瀏覽器不支援掃描，請手動輸入（iOS 可用相機 App 掃 QR 後貼上）', 'error');
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
        if (parsed) {
          serverInput.value = parsed.server || '';
          tokenInput.value = parsed.token || '';
          stopScan();
          setPairingStatus('已讀取 QR，按「連線」', 'ok');
          if (parsed.server && parsed.token) connectBtn.click();
          return;
        }
      }
    } catch {}
    scanRAF = requestAnimationFrame(scanLoop);
  }

  function parsePairingPayload(raw) {
    if (!raw) return null;
    try { const o = JSON.parse(raw); if (o.server || o.token) return o; } catch {}
    // va://host:port?token=xxx 或 ws(s)/http(s)://...?token=xxx
    const m = raw.match(/(?:va|wss?|https?):\/\/([^?\s]+)(?:\?token=([^\s&]+))?/i);
    if (m) return { server: m[1], token: m[2] || '' };
    return null;
  }

  function stopScan() {
    scanner.hidden = true;
    if (scanRAF) cancelAnimationFrame(scanRAF);
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    detector = null;
  }

  // ====================================================================
  // 助理畫面：狀態機渲染
  // ====================================================================
  const STATE_TEXT = {
    idle: 'IDLE', listening: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING',
  };
  let currentState = 'idle';

  function renderState(state, detail) {
    currentState = state || 'idle';
    orbZone.className = 'orb-zone ' + currentState;
    stateText.textContent = STATE_TEXT[currentState] || currentState.toUpperCase();
    if (detail != null) stateDetail.textContent = detail;
    // 思考/說話中才顯示中斷鈕
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

  // 把連續的 claude 句子併到同一個泡泡
  let claudeBubble = null;
  function appendClaudeSentence(text) {
    if (!claudeBubble) {
      claudeBubble = addBubble('claude', text);
    } else {
      const body = claudeBubble.lastChild;
      body.textContent = (body.textContent ? body.textContent + ' ' : '') + text;
      convo.scrollTop = convo.scrollHeight;
    }
  }

  // ====================================================================
  // TTS 播放佇列（逐句播；對齊桌面 renderer 的行為）
  // ====================================================================
  const ttsQueue = [];
  let playing = false;

  function enqueueTts(base64, format) {
    if (!base64) return;
    ttsQueue.push({ base64, format: format || 'mp3' });
    if (!playing) drainTts();
  }
  function clearTts() {
    ttsQueue.length = 0;
    try { ttsAudio.pause(); ttsAudio.currentTime = 0; } catch {}
    playing = false;
  }
  async function drainTts() {
    playing = true;
    while (ttsQueue.length) {
      const { base64, format } = ttsQueue.shift();
      await playClip(base64, format);
    }
    playing = false;
  }
  function playClip(base64, format) {
    return new Promise((resolve) => {
      ttsAudio.src = `data:audio/${format};base64,${base64}`;
      ttsAudio.onended = ttsAudio.onerror = () => resolve();
      const p = ttsAudio.play();
      if (p && p.catch) p.catch(() => resolve());  // iOS 未解鎖時靜默略過
    });
  }
  // iOS 需在使用者手勢內先 play 一次解鎖音訊
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      ttsAudio.src = 'data:audio/mp3;base64,SUQzAwAAAAAAFlRTU0UAAAAMAAADTGF2ZjU4Ljc2AAA=';
      const p = ttsAudio.play();
      if (p && p.then) p.then(() => { ttsAudio.pause(); }).catch(() => {});
      audioUnlocked = true;
    } catch {}
  }

  // ====================================================================
  // 錄音（MediaRecorder）— 點一下開始、再點結束
  // ====================================================================
  let mediaRecorder = null, mediaStream = null, chunks = [], recording = false;

  async function startRecording() {
    if (recording) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      renderState('idle', '無法開啟麥克風：' + e.message);
      return;
    }
    chunks = [];
    const mime = pickMime();
    mediaRecorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = onRecordingStop;
    mediaRecorder.start();
    recording = true;
    micBtn.classList.add('recording');
    renderState('listening', '聆聽中⋯ 再按一次結束');
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    micBtn.classList.remove('recording');
    try { mediaRecorder.stop(); } catch {}
  }

  async function onRecordingStop() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (!chunks.length) { renderState('idle', '錄音為空'); return; }
    const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
    renderState('thinking', '上傳中⋯');
    const base64 = await blobToBase64(blob);
    claudeBubble = null;            // 新回合
    clearTts();
    client.sendAudio(base64, blob.type);
  }

  function pickMime() {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const c of cands) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }
  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
      r.readAsDataURL(blob);
    });
  }

  // 麥克風鈕：點擊切換錄音；正在 thinking/speaking 點則中斷
  micBtn.addEventListener('click', () => {
    unlockAudio();
    if (currentState === 'thinking' || currentState === 'speaking') { doInterrupt(); return; }
    if (recording) stopRecording();
    else startRecording();
  });

  function doInterrupt() {
    clearTts();
    client.interrupt();
    if (recording) stopRecording();
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
    claudeBubble = null;
    clearTts();
    renderState('thinking', 'Claude 思考中⋯');
    client.sendText(text);
    textInput.value = '';
  });

  // ====================================================================
  // 斷線
  // ====================================================================
  disconnectBtn.addEventListener('click', () => {
    client.disconnect();
    clearTts();
    if (recording) stopRecording();
    showScreen('pairing');
    setPairingStatus('已斷線');
    connectBtn.disabled = false;
  });

  // ====================================================================
  // 用量條（沿用桌面格式：今日 / 本月 / 上限）
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
  // 連線層事件 → UI
  // ====================================================================
  client.on('status', ({ connected, detail }) => {
    connText.textContent = detail || (connected ? '已連線' : '未連線');
    connPill.classList.toggle('online', !!connected);
    connPill.classList.toggle('offline', !connected);
    if (!connected && pairingScreen.classList.contains('active')) {
      connectBtn.disabled = false;
      setPairingStatus(detail || '連線失敗', 'error');
    }
  });

  client.on('auth', ({ ok, error }) => {
    if (ok) {
      showScreen('assistant');
      clearConvo();
      renderState('idle', '已連線，按住下方按鈕說話');
      const host = (client.server || '').replace(/^wss?:\/\//, '');
      connText.textContent = host || '已連線';
    } else {
      connectBtn.disabled = false;
      setPairingStatus(error || '配對碼錯誤或已失效', 'error');
      client.disconnect(true);
    }
  });

  client.on('state', ({ state, detail }) => renderState(state, detail));
  client.on('transcript', ({ text }) => { if (text) addBubble('you', text); });
  client.on('tool', ({ name, target }) => {
    const labels = { read_file: '讀取檔案', write_file: '寫入檔案', list_directory: '查看資料夾', fetch_url: '查網路資料', web_search: '網路搜尋' };
    const label = labels[name] || name;
    addBubble('tool', label + (target ? '：' + target : ''));
  });
  client.on('sentence', ({ text }) => { if (text) appendClaudeSentence(text); });
  client.on('tts', ({ audioBase64, format }) => enqueueTts(audioBase64, format));
  client.on('reply', ({ text }) => {
    if (text && !claudeBubble) addBubble('claude', text);  // 沒串流過 → 補整段
    claudeBubble = null;
  });
  client.on('usage', ({ summary }) => renderUsage(summary));
  client.on('error', ({ message, code }) => {
    const map = {
      AI_BUSY: 'AI 正在處理上一個請求，稍等一下',
      MONTHLY_CAP_REACHED: '已達本月用量上限',
      MODEL_PRICE_UNKNOWN: '此模型無定價、無法控管上限',
    };
    const msg = map[code] || message || '發生錯誤';
    if (pairingScreen.classList.contains('active')) {
      connectBtn.disabled = false;
      setPairingStatus(msg, 'error');
    } else {
      renderState('idle', '⚠ ' + msg);
    }
  });

  // 初始畫面
  showScreen('pairing');
})();
