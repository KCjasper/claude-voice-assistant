// settings.js — 設定頁渲染端

const $ = (id) => document.getElementById(id);

const els = {
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  keyStatus: $('keyStatus'),
  reveal: $('btnReveal'),
  saveKey: $('btnSaveKey'),
  test: $('btnTest'),
  clearKey: $('btnClearKey'),
  testResult: $('testResult'),
  defaultModel: $('defaultModel'),
  modelRouting: $('modelRouting'),
  jarvisMode: $('jarvisMode'),
  ttsVoice: $('ttsVoice'),
  ttsRate: $('ttsRate'),
  rateValue: $('rateValue'),
  monthlyCap: $('monthlyCap'),
  close: $('btnClose'),
  closeFoot: $('btnCloseFoot'),
  saveAll: $('btnSaveAll'),
  // 搜尋
  searchProvider: $('searchProvider'),
  searchKey: $('searchKey'),
  searchKeyStatus: $('searchKeyStatus'),
  revealSearch: $('btnRevealSearch'),
  googleCxField: $('googleCxField'),
  googleCx: $('googleCx'),
  saveSearch: $('btnSaveSearch'),
  clearSearch: $('btnClearSearch'),
  searchHint: $('searchHint'),
  previewVoice: $('btnPreviewVoice'),
  // TTS 引擎 / ElevenLabs
  ttsEngine: $('ttsEngine'),
  elevenBlock: $('elevenBlock'),
  edgeVoiceField: $('edgeVoiceField'),
  elevenKey: $('elevenKey'),
  elevenKeyStatus: $('elevenKeyStatus'),
  revealEleven: $('btnRevealEleven'),
  saveEleven: $('btnSaveEleven'),
  loadVoices: $('btnLoadVoices'),
  clearEleven: $('btnClearEleven'),
  elevenVoice: $('elevenVoice'),
  previewEleven: $('btnPreviewEleven'),
  elevenModel: $('elevenModel'),
};

let savedElevenVoiceId = '';

const SEARCH_HINTS = {
  tavily: '到 tavily.com 用 Email/Google 註冊（免費、不綁卡）→ 在 Dashboard 拿 API Key（tvly-... 開頭，每月 1000 次免費）',
  brave: '到 brave.com/search/api 註冊 → 拿 Subscription Token（免費方案 2000 次/月，需綁卡驗證）',
  google: '到 Google Cloud 開啟 Custom Search API 拿 API Key，再到 programmablesearchengine.google.com 建搜尋引擎拿 cx（設定為搜尋整個網路）',
};

// provider → 加密 secret 名稱
function searchSecretName(provider) {
  if (provider === 'google') return 'googleSearchKey';
  if (provider === 'brave') return 'braveSearchKey';
  return 'tavilySearchKey';
}

// ===== 載入既有設定 =====
async function loadAll() {
  const prefs = await window.api.getPrefs();
  els.baseUrl.value = prefs.baseUrl;
  els.defaultModel.value = prefs.defaultModel;
  els.modelRouting.checked = !!prefs.modelRouting;
  els.jarvisMode.checked = !!prefs.jarvisMode;
  els.ttsVoice.value = prefs.ttsVoice;
  els.ttsRate.value = prefs.ttsRate;
  els.rateValue.textContent = `${Number(prefs.ttsRate).toFixed(2)}×`;
  els.monthlyCap.value = prefs.monthlyCapUsd;

  // 用量統計
  if (window.UsageUtil) {
    const sum = window.UsageUtil.summary(prefs.usage);
    const fmt = window.UsageUtil.fmtMoney;
    const sm = document.getElementById('statMonth');
    const st = document.getElementById('statToday');
    if (sm) sm.textContent = fmt(sum.month.usd);
    if (st) st.textContent = fmt(sum.today.usd);
  }

  const hasKey = await window.api.hasApiKey();
  if (hasKey) {
    els.keyStatus.textContent = '✓ Key 已加密儲存（內容不顯示）';
    els.keyStatus.className = 'key-status ok';
    els.apiKey.placeholder = '已儲存 · 要更換才需要重新輸入';
  } else {
    els.keyStatus.textContent = '尚未設定';
    els.keyStatus.className = 'key-status';
  }

  // 搜尋設定
  els.searchProvider.value = prefs.searchProvider || 'tavily';
  els.googleCx.value = prefs.googleCx || '';
  updateSearchProviderUI();
  await refreshSearchKeyStatus();

  // TTS 引擎 / ElevenLabs
  els.ttsEngine.value = prefs.ttsEngine || 'edge';
  els.elevenModel.value = prefs.elevenModel || 'eleven_multilingual_v2';
  savedElevenVoiceId = prefs.elevenVoiceId || '';
  updateEngineUI();
  await refreshElevenKeyStatus();
  // 若已選 elevenlabs 且有 key，自動載入聲音
  if (els.ttsEngine.value === 'elevenlabs' && await window.api.hasSecret('elevenLabsKey')) {
    loadElevenVoices();
  }
}

function updateEngineUI() {
  const eleven = els.ttsEngine.value === 'elevenlabs';
  els.elevenBlock.style.display = eleven ? '' : 'none';
  els.edgeVoiceField.style.display = eleven ? 'none' : '';
}

async function refreshElevenKeyStatus() {
  const has = await window.api.hasSecret('elevenLabsKey');
  if (has) {
    els.elevenKeyStatus.textContent = '✓ 已加密儲存';
    els.elevenKeyStatus.className = 'key-status ok';
    els.elevenKey.placeholder = '已儲存 · 要更換才需重新輸入';
  } else {
    els.elevenKeyStatus.textContent = '尚未設定';
    els.elevenKeyStatus.className = 'key-status';
    els.elevenKey.placeholder = '貼上 ElevenLabs API Key（sk_...）';
  }
}

async function loadElevenVoices() {
  els.loadVoices.textContent = '⟳ 載入中';
  els.loadVoices.disabled = true;
  try {
    const res = await window.api.listElevenVoices();
    if (!res.ok) { showResult('err', `載入聲音失敗：${res.error}`); return; }
    els.elevenVoice.innerHTML = '';
    if (!res.voices.length) {
      els.elevenVoice.innerHTML = '<option value="">（帳號裡沒有聲音，先去 Voice Library 加入）</option>';
    } else {
      for (const v of res.voices) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.desc ? `${v.name}（${v.desc}）` : v.name;
        els.elevenVoice.appendChild(opt);
      }
      if (savedElevenVoiceId) els.elevenVoice.value = savedElevenVoiceId;
      showResult('ok', `✓ 載入 ${res.voices.length} 個聲音，挑一個按試聽。`);
    }
  } finally {
    els.loadVoices.textContent = '載入我的聲音';
    els.loadVoices.disabled = false;
  }
}

function updateSearchProviderUI() {
  const provider = els.searchProvider.value;
  els.googleCxField.style.display = provider === 'google' ? '' : 'none';
  els.searchHint.textContent = SEARCH_HINTS[provider] || '';
}

async function refreshSearchKeyStatus() {
  const provider = els.searchProvider.value;
  const secretName = searchSecretName(provider);
  const has = await window.api.hasSecret(secretName);
  if (has) {
    els.searchKeyStatus.textContent = '✓ 已加密儲存';
    els.searchKeyStatus.className = 'key-status ok';
    els.searchKey.placeholder = '已儲存 · 要更換才需重新輸入';
  } else {
    els.searchKeyStatus.textContent = '尚未設定';
    els.searchKeyStatus.className = 'key-status';
    els.searchKey.placeholder = '貼上搜尋 API Key';
  }
}

// ===== 顯示 / 隱藏 Key =====
els.reveal.addEventListener('click', () => {
  els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
});

// ===== 即時調整速度顯示 =====
els.ttsRate.addEventListener('input', () => {
  els.rateValue.textContent = `${Number(els.ttsRate.value).toFixed(2)}×`;
});

// ===== Jarvis 模式：勾選時自動帶入 Ryan 英國男聲（Edge 時）=====
els.jarvisMode.addEventListener('change', () => {
  if (els.jarvisMode.checked && els.ttsEngine.value === 'edge') {
    els.ttsVoice.value = 'en-GB-RyanNeural';
    showResult('ok', 'Jarvis 模式：已自動選 Ryan 英國男聲。按試聽聽聽看，記得按「儲存全部設定」。');
  }
});

// ===== TTS 引擎切換 =====
els.ttsEngine.addEventListener('change', async () => {
  updateEngineUI();
  if (els.ttsEngine.value === 'elevenlabs' && await window.api.hasSecret('elevenLabsKey')) {
    loadElevenVoices();
  }
});

// ===== ElevenLabs：顯示/隱藏 key、儲存、清除、載入聲音、試聽 =====
els.revealEleven.addEventListener('click', () => {
  els.elevenKey.type = els.elevenKey.type === 'password' ? 'text' : 'password';
});
els.saveEleven.addEventListener('click', async () => {
  const raw = els.elevenKey.value.trim();
  if (!raw) { showResult('err', '請先貼上 ElevenLabs API Key'); return; }
  const res = await window.api.saveSecret('elevenLabsKey', raw);
  if (res.ok) {
    els.elevenKey.value = '';
    els.elevenKey.type = 'password';
    await refreshElevenKeyStatus();
    showResult('ok', 'Key 已儲存，正在載入你的聲音⋯');
    loadElevenVoices();
  } else {
    showResult('err', `儲存失敗：${res.error}`);
  }
});
els.clearEleven.addEventListener('click', async () => {
  if (!confirm('確定清除 ElevenLabs API Key？')) return;
  await window.api.clearSecret('elevenLabsKey');
  await refreshElevenKeyStatus();
  els.elevenVoice.innerHTML = '<option value="">（請先按「載入我的聲音」）</option>';
  showResult('err', 'ElevenLabs Key 已清除。');
});
els.loadVoices.addEventListener('click', () => loadElevenVoices());

let elevenPreviewAudio = null;
els.previewEleven.addEventListener('click', async () => {
  const voiceId = els.elevenVoice.value;
  if (!voiceId) { showResult('err', '請先載入並選一個聲音'); return; }
  if (elevenPreviewAudio) { try { elevenPreviewAudio.pause(); } catch {} elevenPreviewAudio = null; }
  els.previewEleven.textContent = '⟳ 合成中';
  els.previewEleven.disabled = true;
  try {
    const sample = els.jarvisMode.checked
      ? 'Good day, sir. This is how I would sound as your assistant.'
      : '你好，我是你的語音助理，這是這個聲音的試聽。';
    const res = await window.api.speak(sample, { engine: 'elevenlabs', voiceId, model: els.elevenModel.value });
    if (res.ok) {
      elevenPreviewAudio = new Audio('data:audio/mp3;base64,' + res.audioBase64);
      elevenPreviewAudio.onended = () => { elevenPreviewAudio = null; };
      await elevenPreviewAudio.play();
    } else {
      showResult('err', `試聽失敗：${res.error}`);
    }
  } finally {
    els.previewEleven.textContent = '▶ 試聽';
    els.previewEleven.disabled = false;
  }
});

// ===== 試聽（用目前選的音色 + 速度，不必先儲存）=====
let previewAudio = null;
els.previewVoice.addEventListener('click', async () => {
  if (previewAudio) { try { previewAudio.pause(); } catch {} previewAudio = null; }
  const voice = els.ttsVoice.value;
  const rate = parseFloat(els.ttsRate.value);
  els.previewVoice.textContent = '⟳ 合成中';
  els.previewVoice.disabled = true;
  try {
    const sample = '你好，我是你的語音助理，這是這個聲音的試聽。';
    const res = await window.api.speak(sample, { engine: 'edge', voice, rate });
    if (res.ok) {
      previewAudio = new Audio('data:audio/mp3;base64,' + res.audioBase64);
      previewAudio.onended = () => { previewAudio = null; };
      await previewAudio.play();
    } else {
      showResult('err', `試聽失敗：${res.error}`);
    }
  } catch (e) {
    showResult('err', `試聽失敗：${e.message}`);
  } finally {
    els.previewVoice.textContent = '▶ 試聽';
    els.previewVoice.disabled = false;
  }
});

// ===== 儲存 Key =====
els.saveKey.addEventListener('click', async () => {
  const raw = els.apiKey.value.trim();
  if (!raw) {
    showResult('err', '請先貼上 API Key');
    return;
  }
  if (!raw.startsWith('sk-')) {
    showResult('err', '格式看起來不對 — Claw Router 的 Key 是 sk- 開頭');
    return;
  }
  const res = await window.api.saveApiKey(raw);
  if (res.ok) {
    els.apiKey.value = '';
    els.apiKey.type = 'password';
    els.keyStatus.textContent = '✓ Key 已加密儲存';
    els.keyStatus.className = 'key-status ok';
    showResult('ok', 'Key 儲存成功。建議按 Test Connection 確認可用。');
  } else {
    showResult('err', `儲存失敗：${res.error}`);
  }
});

// ===== 測試連線 =====
els.test.addEventListener('click', async () => {
  showResult('ok', '⟳ 測試中...');
  const baseUrl = els.baseUrl.value.trim();
  if (baseUrl) await window.api.savePrefs({ baseUrl });
  const res = await window.api.testConnection();
  if (res.ok) {
    showResult('ok', `✓ 連線成功！偵測到 ${res.modelCount} 個可用模型。`);
  } else {
    showResult('err', `✗ 連線失敗：${res.error}`);
  }
});

// ===== 清除 Key =====
els.clearKey.addEventListener('click', async () => {
  if (!confirm('確定要清除已儲存的 API Key？\n清除後需重新輸入才能使用語音助理。')) return;
  await window.api.clearApiKey();
  els.keyStatus.textContent = '已清除';
  els.keyStatus.className = 'key-status err';
  els.apiKey.value = '';
  els.apiKey.placeholder = '貼上你的 API Key';
  showResult('err', 'Key 已清除。');
});

// ===== 搜尋：切換服務 / 顯示隱藏 =====
els.searchProvider.addEventListener('change', async () => {
  updateSearchProviderUI();
  await refreshSearchKeyStatus();
});
els.revealSearch.addEventListener('click', () => {
  els.searchKey.type = els.searchKey.type === 'password' ? 'text' : 'password';
});

// ===== 搜尋：儲存 =====
els.saveSearch.addEventListener('click', async () => {
  const provider = els.searchProvider.value;
  await window.api.savePrefs({ searchProvider: provider, googleCx: els.googleCx.value.trim() });

  const raw = els.searchKey.value.trim();
  if (raw) {
    const secretName = searchSecretName(provider);
    const res = await window.api.saveSecret(secretName, raw);
    if (res.ok) {
      els.searchKey.value = '';
      els.searchKey.type = 'password';
      await refreshSearchKeyStatus();
      showResult('ok', '✓ 搜尋設定已儲存。可以對語音助理說「上網查⋯」測試。');
    } else {
      showResult('err', `搜尋 Key 儲存失敗：${res.error}`);
    }
  } else {
    showResult('ok', '✓ 搜尋設定已儲存（Key 未變更）。');
  }
});

// ===== 搜尋：清除 Key =====
els.clearSearch.addEventListener('click', async () => {
  const provider = els.searchProvider.value;
  const secretName = searchSecretName(provider);
  if (!confirm('確定要清除這個搜尋 API Key？')) return;
  await window.api.clearSecret(secretName);
  await refreshSearchKeyStatus();
  showResult('err', '搜尋 Key 已清除。');
});

// ===== 儲存全部 =====
els.saveAll.addEventListener('click', async () => {
  await window.api.savePrefs({
    baseUrl: els.baseUrl.value.trim(),
    defaultModel: els.defaultModel.value,
    modelRouting: els.modelRouting.checked,
    jarvisMode: els.jarvisMode.checked,
    ttsVoice: els.ttsVoice.value,
    ttsRate: parseFloat(els.ttsRate.value),
    monthlyCapUsd: parseFloat(els.monthlyCap.value) || 0,
    searchProvider: els.searchProvider.value,
    googleCx: els.googleCx.value.trim(),
    ttsEngine: els.ttsEngine.value,
    elevenVoiceId: els.elevenVoice.value || savedElevenVoiceId,
    elevenModel: els.elevenModel.value,
  });
  showResult('ok', '✓ 設定已儲存。');
});

// ===== 關閉 =====
els.close.addEventListener('click', () => window.api.closeSettings());
els.closeFoot.addEventListener('click', () => window.api.closeSettings());

// ===== Helper =====
function showResult(kind, msg) {
  els.testResult.className = `test-result show ${kind}`;
  els.testResult.textContent = msg;
}

// ============================================================
// WORKSPACE · 工作資料夾 (#20)
// 後端契約（#18 已接上 preload）：所有方法回傳 { ok, state } 或 { ok:false, error, code }
//   getWorkspace()                -> { ok, state }
//   chooseWorkspace()             -> { ok, canceled?, state }      // 開原生對話框
//   setActiveWorkspace(folderPath)-> { ok, state }
//   removeWorkspace(folderPath)   -> { ok, state }
//   其中 state = { workspaceDir:作用中絕對路徑, isDefault:是否為預設專案夾, approvedFolders:[{path,name}] }
//   危險路徑（磁碟根/系統夾/家目錄頂層/路徑逃逸）由後端 throw -> { ok:false, error, code }
// 後端方法不存在時自動走 mock（瀏覽器預覽 / 降級用）。
// 註：#19 規劃的 workspace:changed 廣播尚未實作，onWorkspaceChanged 之後有再自動接上。
// ============================================================
const wsEls = {
  active: $('wsActivePath'),
  list: $('wsList'),
  pick: $('btnPickWorkspace'),
  note: $('wsNote'),
};

const wsApiReady = !!(window.api && typeof window.api.getWorkspace === 'function');

// 後端未接時的示範狀態
let wsMock = {
  active: 'D:\\Claude-workspace\\projects\\voice-assistant',
  folders: [
    { path: 'D:\\Claude-workspace\\projects\\voice-assistant', name: 'voice-assistant' },
    { path: 'D:\\Claude-workspace', name: 'Claude-workspace（整個工作區）' },
  ],
};

function wsBasename(p) {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function wsSetNote(kind, msg) {
  if (!msg) { wsEls.note.className = 'test-result'; wsEls.note.textContent = ''; return; }
  wsEls.note.className = `test-result show ${kind || 'ok'}`;
  wsEls.note.textContent = msg;
}

// 真實 IPC 的 { ok, state } -> 前端用的扁平 { active, folders, isDefault }
function wsUnwrap(res) {
  const s = (res && res.state) || {};
  return { active: s.workspaceDir || '', folders: s.approvedFolders || [], isDefault: !!s.isDefault };
}

async function wsGet() {
  if (wsApiReady) {
    const res = await window.api.getWorkspace();
    if (!res || !res.ok) throw new Error((res && res.error) || '讀取工作資料夾失敗');
    return wsUnwrap(res);
  }
  return { active: wsMock.active, folders: wsMock.folders.slice(), isDefault: false, mock: true };
}

function renderWorkspace(state) {
  const active = (state && state.active) || '';
  const folders = (state && state.folders) || [];

  wsEls.active.textContent = (active || '（尚未設定）') + (state && state.isDefault ? '　· 預設專案資料夾' : '');
  wsEls.active.title = active || '';

  wsEls.list.innerHTML = '';
  if (!folders.length) {
    const empty = document.createElement('div');
    empty.className = 'ws-empty';
    empty.textContent = '還沒有授權任何資料夾，按下方「選擇資料夾」新增。';
    wsEls.list.appendChild(empty);
    return;
  }

  folders.forEach((f) => {
    const isActive = f.path === active;
    const item = document.createElement('div');
    item.className = 'ws-item' + (isActive ? ' active' : '');

    const main = document.createElement('button');
    main.className = 'ws-item-main';
    main.type = 'button';
    const nameEl = document.createElement('div');
    nameEl.className = 'ws-item-name';
    nameEl.textContent = f.name || wsBasename(f.path);
    const pathEl = document.createElement('div');
    pathEl.className = 'ws-item-path';
    pathEl.textContent = f.path;
    main.appendChild(nameEl);
    main.appendChild(pathEl);
    main.title = isActive ? '目前作用中' : `切換到這個資料夾`;
    main.addEventListener('click', () => { if (!isActive) wsSwitch(f.path); });
    item.appendChild(main);

    if (isActive) {
      const badge = document.createElement('span');
      badge.className = 'ws-badge';
      badge.textContent = '作用中';
      item.appendChild(badge);
    }

    const rm = document.createElement('button');
    rm.className = 'ws-remove';
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = '從授權清單移除';
    rm.addEventListener('click', (e) => { e.stopPropagation(); wsRemove(f.path, f.name); });
    item.appendChild(rm);

    wsEls.list.appendChild(item);
  });
}

async function wsSwitch(path) {
  if (!wsApiReady) {
    wsMock.active = path;
    renderWorkspace(await wsGet());
    wsSetNote('ok', `（示範）已切換到 ${path}`);
    return;
  }
  const res = await window.api.setActiveWorkspace(path);
  if (!res || !res.ok) { wsSetNote('err', (res && res.error) || '切換失敗'); return; }
  renderWorkspace(wsUnwrap(res));
  wsSetNote('ok', `✓ 已切換 · AI 現在只在這個資料夾內讀寫`);
}

async function wsRemove(path, name) {
  if (!confirm(`從授權清單移除這個資料夾？\n\n${name || ''}\n${path}\n\n移除後 AI 將無法再讀寫它（資料夾本身不會被刪除）。`)) return;
  if (!wsApiReady) {
    wsMock.folders = wsMock.folders.filter((f) => f.path !== path);
    if (wsMock.active === path) wsMock.active = (wsMock.folders[0] && wsMock.folders[0].path) || '';
    renderWorkspace(await wsGet());
    wsSetNote('ok', '（示範）已從清單移除');
    return;
  }
  const res = await window.api.removeWorkspace(path);
  if (!res || !res.ok) { wsSetNote('err', (res && res.error) || '移除失敗'); return; }
  renderWorkspace(wsUnwrap(res));
  wsSetNote('ok', '已從授權清單移除');
}

wsEls.pick.addEventListener('click', async () => {
  if (!wsApiReady) {
    const n = wsMock.folders.length + 1;
    const p = `D:\\示範資料夾_${n}`;
    wsMock.folders.push({ path: p, name: `示範資料夾_${n}` });
    wsMock.active = p;
    renderWorkspace(await wsGet());
    wsSetNote('warn', `（示範）已新增並切換到 ${p}。實際會跳出原生「選擇資料夾」對話框。`);
    return;
  }
  wsEls.pick.disabled = true;
  wsEls.pick.textContent = '⟳ 開啟對話框…';
  try {
    const res = await window.api.chooseWorkspace();
    if (res && res.canceled) return;
    if (!res || !res.ok) { wsSetNote('err', (res && res.error) || '選擇失敗'); return; }
    const st = wsUnwrap(res);
    renderWorkspace(st);
    wsSetNote('ok', `✓ 已加入並切換到 ${st.active}`);
  } finally {
    wsEls.pick.disabled = false;
    wsEls.pick.textContent = '＋ 選擇資料夾…';
  }
});

// 後端切換後廣播 → 即時更新（多視窗一致）
if (wsApiReady && typeof window.api.onWorkspaceChanged === 'function') {
  window.api.onWorkspaceChanged((state) => renderWorkspace(state));
}

async function initWorkspace() {
  try {
    renderWorkspace(await wsGet());
    if (!wsApiReady) {
      wsSetNote('warn', '後端 IPC 尚未接上（等 #18 / #19），以下為介面示範。接好後即為真實切換。');
    }
  } catch (e) {
    wsSetNote('err', `工作資料夾載入失敗：${e.message}`);
  }
}

// ============================================================
// REMOTE · 手機遠端 (#24)
// 後端契約（#21/#22 已接 preload）：
//   getRemoteStatus()  -> { ok, running, port, clients, pairingToken, pairingConsumed, pairingExpiresAt, ... }
//   getRemoteAccess()  -> { ok, server, lan:[{baseUrl,pairingUrl,qrDataUrl,address,interface}], tunnel:{status,publicUrl}, public, warnings }
//   startRemote({port?}) / stopRemote() / rotateRemoteToken() -> { ok, ...state }
//   startRemoteTunnel({acknowledgeRisk}) / stopRemoteTunnel()  -> { ok, status, publicUrl, ... }
//   onRemoteState(cb) / onRemoteTunnelState(cb)               -> 廣播
// 後端方法不存在時走 mock（瀏覽器預覽用）。
// ============================================================
const rmEls = {
  enable: $('remoteEnable'),
  block: $('remoteActiveBlock'),
  qr: $('remoteQr'),
  url: $('remoteUrl'),
  token: $('remoteToken'),
  tokenState: $('remoteTokenState'),
  copyToken: $('remoteCopyToken'),
  rotate: $('remoteRotate'),
  tunnelEnable: $('remoteTunnelEnable'),
  publicUrl: $('remotePublicUrl'),
  warn: $('remoteWarn'),
  note: $('remoteNote'),
};
const rmApiReady = !!(window.api && typeof window.api.getRemoteStatus === 'function');

// 預覽用假 QR（純前端 SVG，不是真的可掃）
const MOCK_QR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#fff"/>'
  + '<g fill="#000"><rect x="8" y="8" width="28" height="28"/><rect x="84" y="8" width="28" height="28"/><rect x="8" y="84" width="28" height="28"/>'
  + '<rect x="48" y="16" width="10" height="10"/><rect x="64" y="32" width="10" height="10"/><rect x="48" y="56" width="12" height="12"/>'
  + '<rect x="80" y="64" width="10" height="10"/><rect x="96" y="84" width="10" height="10"/><rect x="64" y="96" width="10" height="10"/></g></svg>'
);
let rmMock = { running: false, token: 'demo-PAIR-7f3a91', tunnel: false };

function rmNote(kind, msg) {
  if (!msg) { rmEls.note.className = 'test-result'; rmEls.note.textContent = ''; return; }
  rmEls.note.className = `test-result show ${kind || 'ok'}`;
  rmEls.note.textContent = msg;
}

async function rmGetStatus() {
  if (rmApiReady) return await window.api.getRemoteStatus();
  return { ok: true, running: rmMock.running };
}
async function rmGetAccess() {
  if (rmApiReady) return await window.api.getRemoteAccess();
  // mock
  if (!rmMock.running) return { ok: true, server: { running: false }, lan: [], tunnel: { status: 'stopped', publicUrl: null }, public: null, warnings: [] };
  return {
    ok: true,
    server: { running: true, port: 8787, pairingToken: rmMock.token, pairingConsumed: false },
    lan: [{ baseUrl: 'http://192.168.0.12:8787/', pairingUrl: 'http://192.168.0.12:8787/#token=' + rmMock.token, qrDataUrl: MOCK_QR, address: '192.168.0.12', interface: 'Wi-Fi' }],
    tunnel: { status: rmMock.tunnel ? 'running' : 'stopped', publicUrl: rmMock.tunnel ? 'https://demo-xyz.trycloudflare.com' : null },
    public: rmMock.tunnel ? { baseUrl: 'https://demo-xyz.trycloudflare.com', pairingUrl: 'https://demo-xyz.trycloudflare.com/#token=' + rmMock.token, qrDataUrl: MOCK_QR } : null,
    warnings: rmMock.tunnel ? ['（示範）對外網址已公開，用完請關閉通道。'] : [],
  };
}

function renderRemoteAccess(access) {
  const server = access.server || {};
  const lan = access.lan || [];
  const running = !!server.running;
  rmEls.block.style.display = running ? '' : 'none';
  if (!running) return;

  // QR + 網址（取第一個 LAN 介面；多介面就列出）
  const primary = lan[0];
  if (primary && primary.qrDataUrl) { rmEls.qr.src = primary.qrDataUrl; rmEls.qr.style.visibility = 'visible'; }
  else rmEls.qr.style.visibility = 'hidden';
  rmEls.url.textContent = lan.length ? lan.map((l) => l.baseUrl).join('\n') : '（找不到區網位址，請確認已連上 Wi-Fi）';

  // 配對碼
  const token = server.pairingToken || '—';
  rmEls.token.textContent = token;
  rmEls.token.dataset.token = token;
  rmEls.tokenState.textContent = server.pairingConsumed ? '· 已被使用，重新產生才能再配對' : '· 有效約 10 分鐘';

  // 對外通道
  const tunnel = access.tunnel || {};
  const isTunnel = tunnel.status === 'running' && tunnel.publicUrl;
  rmEls.tunnelEnable.checked = !!isTunnel;
  rmEls.publicUrl.style.display = isTunnel ? '' : 'none';
  if (isTunnel) rmEls.publicUrl.textContent = '對外網址：' + tunnel.publicUrl;

  // 警告
  const warnings = access.warnings || [];
  if (warnings.length) { rmEls.warn.className = 'test-result show warn'; rmEls.warn.textContent = '⚠ ' + warnings.join('\n'); }
  else { rmEls.warn.className = 'test-result'; rmEls.warn.textContent = ''; }
}

async function refreshRemoteAccess() {
  try { renderRemoteAccess(await rmGetAccess()); }
  catch (e) { rmNote('err', '讀取遠端資訊失敗：' + e.message); }
}

rmEls.enable.addEventListener('change', async () => {
  const on = rmEls.enable.checked;
  rmEls.enable.disabled = true;
  try {
    if (on) {
      const res = rmApiReady ? await window.api.startRemote({}) : (rmMock.running = true, { ok: true });
      if (!res.ok) { rmEls.enable.checked = false; rmNote('err', res.error || '啟動失敗'); return; }
      rmNote('ok', '✓ 手機遠端已開啟，用手機掃下方 QR 連上。');
      await refreshRemoteAccess();
    } else {
      if (rmApiReady) await window.api.stopRemote(); else { rmMock.running = false; rmMock.tunnel = false; }
      rmEls.block.style.display = 'none';
      rmNote('', '');
    }
  } finally { rmEls.enable.disabled = false; }
});

rmEls.rotate.addEventListener('click', async () => {
  rmEls.rotate.disabled = true;
  try {
    if (rmApiReady) {
      const res = await window.api.rotateRemoteToken();
      if (!res.ok) { rmNote('err', res.error || '重新產生失敗'); return; }
    } else {
      rmMock.token = 'demo-PAIR-' + Math.random().toString(16).slice(2, 8);
    }
    await refreshRemoteAccess();
    rmNote('ok', '已產生新配對碼，舊的即失效（已連的手機需重新配對）。');
  } finally { rmEls.rotate.disabled = false; }
});

rmEls.copyToken.addEventListener('click', async () => {
  const token = rmEls.token.dataset.token || rmEls.token.textContent;
  if (!token || token === '—') return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(token);
    else { const ta = document.createElement('textarea'); ta.value = token; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    rmNote('ok', '配對碼已複製。');
  } catch { rmNote('err', '複製失敗，請手動選取。'); }
});

rmEls.tunnelEnable.addEventListener('change', async () => {
  const on = rmEls.tunnelEnable.checked;
  if (on) {
    if (!confirm('開放對外連線會把這台「能讀寫檔案的助理」透過 Cloudflare 公開到網際網路。\n配對碼務必保密，用完請關閉。\n\n確定要開啟嗎？')) {
      rmEls.tunnelEnable.checked = false; return;
    }
    rmEls.tunnelEnable.disabled = true;
    try {
      const res = rmApiReady ? await window.api.startRemoteTunnel({ acknowledgeRisk: true }) : (rmMock.tunnel = true, { ok: true });
      if (!res.ok) {
        rmEls.tunnelEnable.checked = false;
        rmNote('err', res.code === 'REMOTE_TUNNEL_BINARY_MISSING' ? '找不到 cloudflared，請先安裝。' : (res.error || '通道啟動失敗'));
        return;
      }
      await refreshRemoteAccess();
    } finally { rmEls.tunnelEnable.disabled = false; }
  } else {
    rmEls.tunnelEnable.disabled = true;
    try {
      if (rmApiReady) await window.api.stopRemoteTunnel(); else rmMock.tunnel = false;
      await refreshRemoteAccess();
    } finally { rmEls.tunnelEnable.disabled = false; }
  }
});

// 後端廣播 → 即時更新
if (rmApiReady) {
  if (typeof window.api.onRemoteState === 'function') window.api.onRemoteState(() => refreshRemoteAccess());
  if (typeof window.api.onRemoteTunnelState === 'function') window.api.onRemoteTunnelState(() => refreshRemoteAccess());
}

async function initRemote() {
  try {
    const status = await rmGetStatus();
    const running = !!(status && status.running);
    rmEls.enable.checked = running;
    if (running) await refreshRemoteAccess();
    if (!rmApiReady) rmNote('warn', '後端遠端服務未連上（瀏覽器預覽），以下為介面示範。');
  } catch (e) {
    rmNote('err', '遠端狀態載入失敗：' + e.message);
  }
}

// ============================================================
// MODEL · 動態模型清單 (#11)
// 後端契約：listModels({force?}) -> { ok, models:[{id, ownedBy, priceKnown, selectableUnderCap}], cached, ... }
// 後端不存在 / 抓取失敗時，保留 HTML 內建的寫死清單當 fallback。
// ============================================================
const mdlEls = { select: els.defaultModel, refresh: $('btnRefreshModels'), status: $('modelListStatus') };
const mdlApiReady = !!(window.api && typeof window.api.listModels === 'function');

function populateModels(models, keep) {
  if (!Array.isArray(models) || !models.length) return false;
  const current = keep || mdlEls.select.value;
  mdlEls.select.innerHTML = '';
  const groups = {};
  models.forEach((m) => { (groups[m.ownedBy || 'other'] = groups[m.ownedBy || 'other'] || []).push(m); });
  Object.keys(groups).forEach((g) => {
    const og = document.createElement('optgroup');
    og.label = g;
    groups[g].forEach((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.id + (m.priceKnown ? '' : '（無定價）');
      if (!m.selectableUnderCap) o.disabled = true;
      og.appendChild(o);
    });
    mdlEls.select.appendChild(og);
  });
  if (current && models.some((m) => m.id === current)) mdlEls.select.value = current;
  return true;
}

async function refreshModels(force, keep) {
  if (!mdlApiReady) { mdlEls.status.textContent = ''; return; }
  mdlEls.status.textContent = '· 載入中⋯';
  const want = keep || mdlEls.select.value;
  try {
    const res = await window.api.listModels({ force: !!force });
    if (!res || !res.ok || !Array.isArray(res.models) || !res.models.length) {
      mdlEls.status.textContent = force ? '· 載入失敗，沿用內建清單' : '';
      return;
    }
    populateModels(res.models, want);
    mdlEls.status.textContent = `· ${res.models.length} 個可用${res.cached ? '（快取）' : ''}`;
  } catch (e) {
    mdlEls.status.textContent = force ? '· 載入失敗：' + e.message : '';
  }
}

if (mdlEls.refresh) {
  if (!mdlApiReady) { mdlEls.refresh.disabled = true; mdlEls.refresh.title = '後端未提供模型清單'; }
  mdlEls.refresh.addEventListener('click', () => refreshModels(true));
}

async function initModels() {
  if (!mdlApiReady) return;
  try {
    const prefs = await window.api.getPrefs();
    await refreshModels(false, prefs.defaultModel);
  } catch {}
}

// 初始化
loadAll();
initWorkspace();
initRemote();
initModels();
