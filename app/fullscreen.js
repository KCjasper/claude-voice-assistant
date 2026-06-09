// fullscreen.js — Ops Center：接收浮窗推送的 session 快照並渲染

const STATES = {
  idle: { text: 'IDLE', detail: '按住麥克風或 Ctrl+Shift+Space 說話' },
  listening: { text: 'LISTENING', detail: '說完後自動送出' },
  thinking: { text: 'THINKING', detail: 'Claude 正在處理你的請求' },
  speaking: { text: 'SPEAKING', detail: '說「停」可以打斷' },
};

const TOOL_META = {
  read_file: { icon: '📄', label: 'Read' },
  write_file: { icon: '✍️', label: 'Write' },
  list_directory: { icon: '📁', label: 'List' },
  fetch_url: { icon: '🌐', label: 'Fetch' },
  web_search: { icon: '🔍', label: 'Search' },
};

const $ = (id) => document.getElementById(id);
const statusText = $('statusText');
const statusDetail = $('statusDetail');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function render(s) {
  if (!s) return;

  // 中央狀態
  const st = STATES[s.state] || STATES.idle;
  document.body.className = s.state || 'idle';
  statusText.textContent = st.text;
  statusDetail.textContent = s.detail || st.detail;

  // 對話
  const convo = $('convo');
  const turns = (s.convo || []).length;
  $('convoMeta').textContent = turns ? `${turns} 則訊息` : '—';
  let html = (s.convo || []).map((m) => {
    const role = m.role === 'you' ? 'YOU' : 'CLAUDE';
    const cls = m.role === 'you' ? 'msg-you' : 'msg-claude';
    return `<div class="msg ${cls}"><div class="msg-role">${role}</div><div class="msg-body">${esc(m.text)}</div></div>`;
  }).join('');
  if (s.working) {
    html += `<div class="msg msg-claude in-progress"><div class="msg-role">CLAUDE · WORKING</div>` +
      `<div class="msg-body"><span class="dots"><span></span><span></span><span></span></span>${esc(s.working)}</div></div>`;
  }
  if (!html) html = '<div class="convo-empty">尚無對話 — 按住麥克風說句話試試</div>';
  convo.innerHTML = html;
  convo.scrollTop = convo.scrollHeight;

  // 任務狀態
  const running = s.state === 'thinking' || s.state === 'speaking';
  $('taskStatus').textContent = running ? 'RUNNING' : (s.state || 'idle').toUpperCase();
  $('taskBody').innerHTML = s.working
    ? `<span class="spin">⟳</span> ${esc(s.working)}`
    : (running ? 'Claude 回應中⋯' : '待命中');

  // 工具步驟
  const steps = s.steps || [];
  $('taskSteps').innerHTML = steps.length
    ? steps.map((st) => {
        const cls = st.status === 'running' ? 'running' : 'done';
        const mark = st.status === 'running' ? '<span class="step-mark spin">⟳</span>' : '<span class="step-mark">✓</span>';
        const meta = st.status === 'running' ? 'running…' : 'done';
        return `<div class="task-step ${cls}">${mark}<span class="step-text">${esc(st.text)}</span><span class="step-meta">${meta}</span></div>`;
      }).join('')
    : '<div class="task-step pending"><span class="step-mark">○</span><span class="step-text">這回合未使用工具</span></div>';

  // 工具標籤
  const tools = s.tools || [];
  $('toolsList').innerHTML = tools.length
    ? tools.map((t) => {
        const m = TOOL_META[t] || { icon: '🔧', label: t };
        return `<span class="tool-chip">${m.icon} ${esc(m.label)}</span>`;
      }).join('')
    : '<span class="tool-chip dim">—</span>';

  // 用量
  const u = s.usage || {};
  $('uModel').textContent = u.model || '—';
  $('uTokens').textContent = u.tokens ? u.tokens.toLocaleString() : '—';
  $('uCost').textContent = '$' + (u.monthUsd || 0).toFixed((u.monthUsd || 0) < 0.1 ? 3 : 2);
  $('uElapsed').textContent = s.elapsedMs ? (s.elapsedMs / 1000).toFixed(1) + 's' : '—';
}

// 開啟時先抓目前狀態，之後接收即時更新
window.api.getSession().then(render).catch(() => {});
window.api.onSessionState(render);

// === ESC 收回浮窗 ===
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.collapseToFloating();
});

// === 視窗控制 ===
$('btnCollapse').addEventListener('click', () => window.api.collapseToFloating());
$('btnClose').addEventListener('click', () => window.api.closeWindow());
$('btnSettings').addEventListener('click', () => window.api.openSettings());
