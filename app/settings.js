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

// 初始化
loadAll();
initWorkspace();
