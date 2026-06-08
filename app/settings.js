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
  ttsVoice: $('ttsVoice'),
  ttsRate: $('ttsRate'),
  rateValue: $('rateValue'),
  monthlyCap: $('monthlyCap'),
  close: $('btnClose'),
  closeFoot: $('btnCloseFoot'),
  saveAll: $('btnSaveAll'),
};

// ===== 載入既有設定 =====
async function loadAll() {
  const prefs = await window.api.getPrefs();
  els.baseUrl.value = prefs.baseUrl;
  els.defaultModel.value = prefs.defaultModel;
  els.modelRouting.checked = !!prefs.modelRouting;
  els.ttsVoice.value = prefs.ttsVoice;
  els.ttsRate.value = prefs.ttsRate;
  els.rateValue.textContent = `${Number(prefs.ttsRate).toFixed(2)}×`;
  els.monthlyCap.value = prefs.monthlyCapUsd;

  const hasKey = await window.api.hasApiKey();
  if (hasKey) {
    els.keyStatus.textContent = '✓ Key 已加密儲存（內容不顯示）';
    els.keyStatus.className = 'key-status ok';
    els.apiKey.placeholder = '已儲存 · 要更換才需要重新輸入';
  } else {
    els.keyStatus.textContent = '尚未設定';
    els.keyStatus.className = 'key-status';
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

// ===== 儲存全部 =====
els.saveAll.addEventListener('click', async () => {
  await window.api.savePrefs({
    baseUrl: els.baseUrl.value.trim(),
    defaultModel: els.defaultModel.value,
    modelRouting: els.modelRouting.checked,
    ttsVoice: els.ttsVoice.value,
    ttsRate: parseFloat(els.ttsRate.value),
    monthlyCapUsd: parseFloat(els.monthlyCap.value) || 0,
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

// 初始化
loadAll();
