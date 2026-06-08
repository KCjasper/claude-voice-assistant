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
  } else {
    setState('idle', { detail: `辨識失敗：${sttRes.error}` });
  }
}

// ===== 交給 Claude（Claw Router）處理 — 串流邊生成邊念 =====
let activeUserText = '';

async function askClaude(userText) {
  activeUserText = userText;
  resetSpeakQueue();
  setState('thinking', {
    detail: 'Claude 思考中⋯',
    transcript: { speaker: 'YOU', body: userText },
  });

  // 句子會在 onAiProgress 的 phase:'sentence' 進到 TTS 佇列邊念
  const res = await window.api.chat(userText);

  if (!res.ok) {
    resetSpeakQueue();
    setState('idle', {
      detail: `出錯了：${res.error}`,
      transcript: { speaker: 'YOU', body: userText },
    });
    return;
  }

  // 等佇列把剩下的句子念完
  await waitQueueDrain();

  if (!spokeAnything) {
    // 沒有任何句子被串流出來 → 退回一次把整段念出來
    await speak(res.text || '（Claude 沒有回覆內容）', { youSaid: userText });
  } else {
    setState('idle', { detail: '✓ 完成', transcript: { speaker: 'CLAUDE', body: res.text || '' } });
  }
}

// ===== TTS 佇列（pipelined：播當前句時先合成下一句）=====
let currentAudio = null;
let speakQueue = [];        // 尚未合成的句子
let synthAhead = null;      // 預先合成中的下一句 { text, promise }
let draining = false;
let spokeAnything = false;

function resetSpeakQueue() {
  stopSpeaking();
  speakQueue = [];
  synthAhead = null;
  draining = false;
  spokeAnything = false;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function queueBusy() { return draining || speakQueue.length > 0 || !!synthAhead; }

// 輪詢等到佇列排空；多等一拍接住可能還在途中的最後一句 IPC 事件
async function waitQueueDrain() {
  while (queueBusy()) await sleep(80);
  await sleep(150);
  while (queueBusy()) await sleep(80);
}

function enqueueSentence(text) {
  if (!text) return;
  spokeAnything = true;
  speakQueue.push(text);
  if (!draining) drainQueue();
}

function synth(text) {
  return window.api.speak(text).then(res => (res.ok ? res.audioBase64 : null));
}

async function drainQueue() {
  draining = true;
  while (speakQueue.length > 0 || synthAhead) {
    let text, b64;
    if (synthAhead) {
      ({ text } = synthAhead);
      b64 = await synthAhead.promise;
      synthAhead = null;
    } else {
      text = speakQueue.shift();
      b64 = await synth(text);
    }
    // 先開始合成下一句（與播放當前句平行）
    if (speakQueue.length > 0) {
      const next = speakQueue.shift();
      synthAhead = { text: next, promise: synth(next) };
    }
    if (b64) {
      setState('speaking', { transcript: { speaker: 'CLAUDE', body: text } });
      await playAudioBlocking(b64);
    }
  }
  draining = false;
}

function playAudioBlocking(b64) {
  return new Promise((resolve) => {
    const audio = new Audio('data:audio/mp3;base64,' + b64);
    currentAudio = audio;
    audio.onended = () => { currentAudio = null; resolve(); };
    audio.onerror = () => { currentAudio = null; resolve(); };
    audio.play().catch(() => { currentAudio = null; resolve(); });
  });
}

function stopSpeaking() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio = null;
  }
}

// 單段直接念（fallback / 測試用）
async function speak(text, opts = {}) {
  if (!text) return;
  stopSpeaking();
  setState('thinking', { detail: '合成語音中⋯', transcript: { speaker: 'YOU', body: opts.youSaid || text } });
  const res = await window.api.speak(text);
  if (!res.ok) {
    setState('idle', { detail: `語音合成失敗：${res.error}` });
    return;
  }
  setState('speaking', { transcript: { speaker: 'CLAUDE', body: text } });
  await playAudioBlocking(res.audioBase64);
  setState('idle', { detail: '✓ 完成', transcript: { speaker: 'CLAUDE', body: text } });
}

async function toggleRecording() {
  // 正在說話 → 打斷（清空佇列）
  if (currentAudio || draining) { resetSpeakQueue(); setState('idle', { clearTranscript: false }); return; }
  if (recorder.isRecording()) await stopRecording();
  else await startRecording();
}

// ===== 點按 =====
btnMic.addEventListener('click', toggleRecording);

// ===== 全域熱鍵（從 main 推來） =====
window.api.onHotkeyToggleRecord(() => toggleRecording());

// ===== Whisper 進度顯示 =====
window.api.onSttProgress((p) => {
  if (p.phase === 'ensure-binary') {
    if (p.step === 'fetch-url')   setState('thinking', { detail: '檢查 Whisper 程式中⋯' });
    if (p.step === 'download') {
      if (p.total) {
        const mb = (p.downloaded / 1048576).toFixed(1);
        const totalMb = (p.total / 1048576).toFixed(1);
        const pct = ((p.downloaded / p.total) * 100).toFixed(0);
        setState('thinking', { detail: `下載 Whisper 程式 ${mb}/${totalMb} MB (${pct}%)` });
      } else {
        setState('thinking', { detail: '下載 Whisper 程式中⋯' });
      }
    }
    if (p.step === 'extract')     setState('thinking', { detail: '解壓 Whisper 程式中⋯' });
  } else if (p.phase === 'ensure-model') {
    setState('thinking', { detail: `準備模型 ${p.model}⋯` });
  } else if (p.stage === 'model' && p.step === 'download') {
    if (p.total) {
      const mb = (p.downloaded / 1048576).toFixed(1);
      const totalMb = (p.total / 1048576).toFixed(1);
      const pct = ((p.downloaded / p.total) * 100).toFixed(0);
      setState('thinking', { detail: `下載模型 ${p.name} ${mb}/${totalMb} MB (${pct}%)` });
    }
  } else if (p.phase === 'transcribe') {
    setState('thinking', { detail: 'Whisper 辨識中⋯' });
  }
});

// ===== AI 進度顯示（Claude 正在用哪個工具）=====
const TOOL_LABELS = {
  read_file: '讀取檔案',
  write_file: '寫入檔案',
  list_directory: '查看資料夾',
  fetch_url: '查網路資料',
};
window.api.onAiProgress((p) => {
  if (p.phase === 'sentence') {
    enqueueSentence(p.text);            // 串流出來的整句 → 進佇列邊念
  } else if (p.phase === 'tool') {
    const label = TOOL_LABELS[p.name] || p.name;
    const target = p.args && (p.args.path || p.args.url) ? `：${p.args.path || p.args.url}` : '';
    if (!draining) setState('thinking', { detail: `Claude 正在${label}${target}` });
  } else if (p.phase === 'thinking') {
    if (!draining) setState('thinking', { detail: 'Claude 思考中⋯' });
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

// 初始狀態
setState('idle', { clearTranscript: true });
