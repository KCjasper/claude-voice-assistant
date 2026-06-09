// renderer.js — 浮窗渲染端
// UI 狀態管理 + 錄音流程編排

// ===== DOM =====
const assistant = document.getElementById('assistant');
const statusText = document.getElementById('statusText');
const statusDetail = document.getElementById('statusDetail');
const transcript = document.getElementById('transcript');
const transcriptSpeaker = document.getElementById('transcriptSpeaker');
const transcriptBody = document.getElementById('transcriptBody');
const devButtons = document.querySelectorAll('.dev-buttons button');
const btnMic = document.getElementById('btnMic');

// ===== 狀態定義 =====
const STATES = {
  idle: {
    text: 'IDLE',
    detail: '按 🎙 或 Ctrl+Shift+Space 開始錄音',
    transcript: null,
  },
  listening: {
    text: 'LISTENING',
    detail: '再按一次結束錄音',
    transcript: null,
  },
  thinking: {
    text: 'THINKING',
    detail: 'Claude 正在處理你的請求',
    transcript: null,
  },
  speaking: {
    text: 'SPEAKING',
    detail: '說「停」可以打斷',
    transcript: null,
  },
};

let currentState = 'idle';

// ===== Ops Center session 快照（推給全螢幕視窗）=====
const session = {
  state: 'idle',
  detail: '',
  convo: [],         // { role:'you'|'claude', text }
  working: null,     // 目前工具活動文字（顯示為進行中氣泡）
  tools: [],         // 本回合用到的工具（去重）
  steps: [],         // 本回合工具步驟 { text, status }
  usage: { model: '', tokens: 0, cost: 0, todayUsd: 0, monthUsd: 0 },
  turnStart: 0,
  elapsedMs: 0,
};

function pushSession() {
  try { window.api.pushSession(session); } catch {}
}

function setState(name, opts = {}) {
  currentState = name;
  assistant.className = 'assistant ' + name;
  statusText.textContent = STATES[name].text;
  statusDetail.textContent = opts.detail || STATES[name].detail;

  if (opts.transcript) {
    transcript.classList.add('show');
    transcriptSpeaker.textContent = opts.transcript.speaker;
    transcriptBody.textContent = opts.transcript.body;
  } else if (opts.clearTranscript) {
    transcript.classList.remove('show');
  }

  devButtons.forEach(b => b.classList.toggle('active', b.dataset.state === name));

  // 同步給 Ops Center
  session.state = name;
  session.detail = opts.detail || STATES[name].detail;
  pushSession();
}

// ===== 錄音流程 =====
const recorder = new VoiceRecorder();
recorder.onError = (e) => {
  console.error('Recorder error:', e);
  setState('idle', { detail: `麥克風錯誤：${e.message}` });
};
// 錄音達 60 秒上限 → 自動停止並送出
recorder.onMaxReached = () => {
  if (recorder.isRecording()) stopRecording();
};

async function startRecording() {
  if (recorder.isRecording()) return;

  // 先確認有 API Key（沒 key 講了也沒人聽）
  const hasKey = await window.api.hasApiKey();
  if (!hasKey) {
    setState('idle', { detail: '請先在 ⚙ 設定中填入 API Key' });
    return;
  }

  try {
    await recorder.start();
    setState('listening', { clearTranscript: true });
  } catch (e) {
    setState('idle', { detail: `無法啟動麥克風：${e.message}` });
  }
}

async function stopRecording() {
  if (!recorder.isRecording()) return;

  setState('thinking', { detail: '正在儲存錄音⋯' });
  const wav = await recorder.stop();

  if (!wav) {
    setState('idle', { detail: '錄音為空' });
    return;
  }

  // 1. 存檔
  const saveRes = await window.api.saveRecording(new Uint8Array(wav));
  if (!saveRes.ok) {
    setState('idle', { detail: `存檔失敗：${saveRes.error}` });
    return;
  }
  const dur = saveRes.durationSec.toFixed(1);

  // 2. 轉文字
  setState('thinking', { detail: `辨識中⋯（錄音 ${dur}s）` });
  const sttRes = await window.api.transcribe(saveRes.path, {
    prompt: 'Claude, Cowork, PerpOS, LendOS, ForexOS, OS Alliance, Sui, WaterX, KC',
  });

  if (sttRes.ok) {
    const text = sttRes.text || '';
    if (!text) {
      setState('idle', { detail: '（沒有辨識到內容，可能太短或太小聲）' });
      return;
    }
    // 階段 5：把辨識的話交給 Claude 處理，再念出 Claude 的回覆
    await askClaude(text);
  } else if (sttRes.code === 'CANCELLED') {
    setState('idle', { detail: '已中斷', clearTranscript: false });
  } else {
    setState('idle', { detail: `辨識失敗：${sttRes.error}` });
  }
}

// ===== 交給 Claude（Claw Router）處理 — 串流邊生成邊念 =====
let activeUserText = '';
let activeTurnId = null;
let turnSequence = 0;

async function askClaude(userText) {
  const turnId = `turn-${Date.now()}-${++turnSequence}`;
  activeTurnId = turnId;
  lastSynthesisError = null;
  activeUserText = userText;
  const speechGeneration = speechQueue.reset();

  // Ops Center：新回合
  session.convo.push({ role: 'you', text: userText });
  if (session.convo.length > 12) session.convo = session.convo.slice(-12);
  session.tools = [];
  session.steps = [];
  session.working = 'Claude 思考中⋯';
  session.turnStart = Date.now();
  session.elapsedMs = 0;

  // 月額上限 / 並發 / 定價未知 由後端統一把關（#6）
  setState('thinking', {
    detail: 'Claude 思考中⋯',
    transcript: { speaker: 'YOU', body: userText },
  });

  // 句子會在 onAiProgress 的 phase:'sentence' 進到 TTS 佇列邊念
  const res = await window.api.chat(userText, { clientTurnId: turnId });

  if (!res.ok) {
    speechQueue.reset();
    if (res.usageSummary) applyUsageSummary(res.usageSummary); // 被擋時也更新用量條
    const interrupted = res.code === 'CANCELLED' || activeTurnId !== turnId;
    const msg = interrupted ? '已中斷' : errorMessageFor(res);
    session.convo.pop(); // 撤回剛加的 you（沒成功送出）
    setState('idle', { detail: msg, transcript: { speaker: 'YOU', body: userText } });
    if (activeTurnId === turnId) activeTurnId = null;
    return;
  }
  if (activeTurnId !== turnId) return;

  // Ops Center：回合完成
  session.convo.push({ role: 'claude', text: res.text || '' });
  if (session.convo.length > 12) session.convo = session.convo.slice(-12);
  session.working = null;
  session.steps.forEach(s => { if (s.status === 'running') s.status = 'done'; });
  session.elapsedMs = Date.now() - session.turnStart;

  // 用量：後端已記錄，前端只消費權威摘要（#6）
  if (res.usageSummary) applyUsageSummary(res.usageSummary);
  session.usage = {
    model: res.model || '',
    tokens: (res.usage && res.usage.total_tokens) || 0,
    cost: res.requestCost || 0,
    todayUsd: res.usageSummary ? res.usageSummary.today.usd : 0,
    monthUsd: res.usageSummary ? res.usageSummary.month.usd : 0,
  };
  pushSession();

  // 等佇列把剩下的句子念完
  const drained = await speechQueue.waitForDrain(speechGeneration);
  if (!drained || activeTurnId !== turnId) return;

  if (!speechQueue.spokeAnything) {
    // 沒有任何句子被串流出來 → 退回一次把整段念出來
    await speak(res.text || '（Claude 沒有回覆內容）', { youSaid: userText });
  } else {
    setState('idle', { detail: '✓ 完成', transcript: { speaker: 'CLAUDE', body: res.text || '' } });
  }
  if (activeTurnId === turnId) activeTurnId = null;
}

// ===== TTS 佇列（pipelined：播當前句時先合成下一句）=====
let lastSynthesisError = null;

function synth(text) {
  return window.api.speak(text).then((res) => {
    if (res.ok) return res.audioBase64;
    lastSynthesisError = res;
    return null;
  }).catch((error) => {
    lastSynthesisError = { error: error.message || 'TTS IPC failed' };
    return null;
  });
}

function createAudioPlayback(b64) {
  const audio = new Audio('data:audio/mp3;base64,' + b64);
  let settled = false;
  let resolvePlayback;
  const promise = new Promise((resolve) => { resolvePlayback = resolve; });
  const finish = () => {
    if (settled) return;
    settled = true;
    audio.onended = null;
    audio.onerror = null;
    resolvePlayback();
  };
  audio.onended = finish;
  audio.onerror = finish;
  audio.play().catch(finish);
  return {
    promise,
    cancel() {
      try { audio.pause(); } catch {}
      try { audio.currentTime = 0; } catch {}
      finish();
    },
  };
}

const speechQueue = new window.SpeechQueueController({
  synthesize: synth,
  createPlayback: createAudioPlayback,
  onSpeaking: (text) => {
    setState('speaking', { transcript: { speaker: 'CLAUDE', body: text } });
  },
});

// 單段直接念（fallback / 測試用）
async function speak(text, opts = {}) {
  if (!text) return;
  lastSynthesisError = null;
  const generation = speechQueue.reset();
  setState('thinking', { detail: '合成語音中⋯', transcript: { speaker: 'YOU', body: opts.youSaid || text } });
  speechQueue.enqueue(text);
  const drained = await speechQueue.waitForDrain(generation);
  if (!drained) return;
  if (lastSynthesisError) {
    setState('idle', { detail: `語音合成失敗：${lastSynthesisError.error}` });
    return;
  }
  setState('idle', { detail: '✓ 完成', transcript: { speaker: 'CLAUDE', body: text } });
}

async function toggleRecording() {
  // 正在說話 → 打斷（清空佇列）
  if (speechQueue.busy()) {
    activeTurnId = null;
    speechQueue.reset();
    window.api.interrupt().catch(() => {});
    setState('idle', { clearTranscript: false });
    return;
  }
  if (recorder.isRecording()) await stopRecording();
  else await startRecording();
}

// ===== 點按 =====
btnMic.addEventListener('click', toggleRecording);

// ===== 全域熱鍵（從 main 推來） =====
window.api.onHotkeyToggleRecord(() => toggleRecording());

// ===== 被中斷（Ops Center 的 Ctrl+Q）→ 停止正在播的 TTS =====
window.api.onPlaybackStop(() => {
  activeTurnId = null;
  speechQueue.reset();
  if (recorder.isRecording()) {
    void recorder.stop().catch(() => {});
  }
  session.working = null;
  session.steps.forEach((step) => {
    if (step.status === 'running') step.status = 'interrupted';
  });
  setState('idle', { detail: '已中斷', clearTranscript: false });
});

// ===== Whisper 進度顯示 =====
// 後端事件有兩類：生命週期用 `phase`、下載/解壓進度用 `stage`+`step`
function mb(n) { return (n / 1048576).toFixed(0); }
function pctStr(p) { return p.total ? ` ${mb(p.downloaded)}/${mb(p.total)}MB (${((p.downloaded / p.total) * 100).toFixed(0)}%)` : ''; }

window.api.onSttProgress((p) => {
  // 進度事件（stage + step）— 優先處理，因為下載細節在這
  if (p.stage === 'binary') {
    if (p.step === 'fetch-url') setState('thinking', { detail: '查詢 Whisper 版本⋯' });
    else if (p.step === 'download') setState('thinking', { detail: `下載 Whisper 程式${pctStr(p)}` });
    else if (p.step === 'extract') setState('thinking', { detail: '解壓 Whisper 程式⋯' });
    return;
  }
  if (p.stage === 'model' && p.step === 'download') {
    setState('thinking', { detail: `下載模型${pctStr(p)}` });
    return;
  }
  // 生命週期事件（phase）
  if (p.phase === 'ensure-binary') setState('thinking', { detail: p.gpu ? '準備 GPU 版 Whisper⋯' : '準備 Whisper⋯' });
  else if (p.phase === 'gpu-fallback') setState('thinking', { detail: 'GPU 版不可用，改用 CPU⋯' });
  else if (p.phase === 'ensure-model') setState('thinking', { detail: `準備模型 ${p.model || ''}⋯` });
  else if (p.phase === 'transcribe') setState('thinking', { detail: 'Whisper 辨識中⋯' });
});

// ===== AI 進度顯示（Claude 正在用哪個工具）=====
const TOOL_LABELS = {
  read_file: '讀取檔案',
  write_file: '寫入檔案',
  list_directory: '查看資料夾',
  fetch_url: '查網路資料',
};
window.api.onAiProgress((p) => {
  if (!activeTurnId || p.clientTurnId !== activeTurnId) return;
  if (p.phase === 'sentence') {
    session.working = null;             // 開始回答了
    speechQueue.enqueue(p.text);        // 串流出來的整句 → 進佇列邊念
  } else if (p.phase === 'tool') {
    const label = TOOL_LABELS[p.name] || p.name;
    const target = p.args && (p.args.path || p.args.url) ? `：${p.args.path || p.args.url}` : '';
    // Ops Center：記錄工具 + 步驟
    if (!session.tools.includes(p.name)) session.tools.push(p.name);
    session.steps.forEach(s => { if (s.status === 'running') s.status = 'done'; });
    session.steps.push({ text: `${label}${target}`, status: 'running' });
    session.working = `Claude 正在${label}${target}`;
    if (!speechQueue.busy()) setState('thinking', { detail: session.working });
    else pushSession();
  } else if (p.phase === 'thinking') {
    session.working = 'Claude 思考中⋯';
    if (!speechQueue.busy()) setState('thinking', { detail: 'Claude 思考中⋯' });
    else pushSession();
  }
});

// ===== 視窗 / 設定 / 全螢幕 =====
document.getElementById('btnClose').addEventListener('click', () => window.api.closeWindow());
document.getElementById('btnMinimize').addEventListener('click', () => window.api.minimizeWindow());
document.getElementById('btnExpand').addEventListener('click', () => window.api.expandToFullscreen());
document.getElementById('orbStage').addEventListener('click', () => window.api.expandToFullscreen());
document.getElementById('btnSettings').addEventListener('click', () => window.api.openSettings());

// ===== DEV 切換器 =====
devButtons.forEach(b => {
  b.addEventListener('click', () => setState(b.dataset.state, { clearTranscript: true }));
});

// ===== 用量追蹤 =====
const usageMeter = document.getElementById('usageMeter');

// 把後端權威用量摘要渲染到浮窗用量條（#6）
// summary 形狀：{ today:{usd,calls}, month:{usd}, capUsd, enabled, overCap }
function applyUsageSummary(s) {
  if (!s || !s.today || !s.month) return;
  const fmt = window.UsageUtil.fmtMoney;
  const cap = s.capUsd || 0;
  const capStr = cap > 0 ? ` / $${cap.toFixed(0)}` : '';
  usageMeter.textContent = `今日 ${fmt(s.today.usd)} · 本月 ${fmt(s.month.usd)}${capStr}`;
  usageMeter.title = `約略用量 · 今日 ${s.today.calls || 0} 次對話`;
  usageMeter.classList.remove('warn', 'over');
  if (cap > 0) {
    if (s.overCap || s.month.usd >= cap) usageMeter.classList.add('over');
    else if (s.month.usd >= cap * 0.8) usageMeter.classList.add('warn');
  }
}

// 啟動時從後端維護的 prefs.usage 重建摘要
async function refreshMeter() {
  const prefs = await window.api.getPrefs();
  const sum = window.UsageUtil.summary(prefs.usage);
  const cap = prefs.monthlyCapUsd || 0;
  applyUsageSummary({
    today: sum.today, month: sum.month,
    capUsd: cap, enabled: cap > 0, overCap: cap > 0 && sum.month.usd >= cap,
  });
}

// 被後端擋下時的訊息
function errorMessageFor(res) {
  switch (res.code) {
    case 'AI_BUSY': return 'AI 正在處理上一個請求，稍等一下再說';
    case 'MONTHLY_CAP_REACHED': return `已達本月上限 $${(res.usageSummary?.capUsd || 0).toFixed(0)} · 到 ⚙ 設定調整`;
    case 'MODEL_PRICE_UNKNOWN': return '此模型無定價、無法控管上限，請改用已知定價的模型';
    default: return `出錯了：${res.error || '未知錯誤'}`;
  }
}

// 初始狀態
setState('idle', { clearTranscript: true });
refreshMeter();
