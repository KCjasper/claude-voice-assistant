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
    const text = sttRes.text || '（沒有辨識到內容，可能太短或太小聲）';
    setState('idle', {
      detail: `✓ 辨識完成（之後階段 5 會交給 Claude）`,
      transcript: { speaker: 'YOU', body: text },
    });
  } else {
    setState('idle', { detail: `辨識失敗：${sttRes.error}` });
  }
}

async function toggleRecording() {
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
