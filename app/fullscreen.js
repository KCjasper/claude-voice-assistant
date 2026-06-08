// fullscreen.js — Ops Center 行為

const statusText = document.getElementById('statusText');
const statusDetail = document.getElementById('statusDetail');

// 四個狀態（與 floating 對齊）
const STATES = {
  idle: { text: 'IDLE', detail: '喊「Hey Claude」喚醒，或按住 Ctrl+Space 說話' },
  listening: { text: 'LISTENING', detail: '說完後自動送出' },
  thinking: { text: 'THINKING', detail: 'Claude 正在處理你的請求' },
  speaking: { text: 'SPEAKING', detail: '說「停」可以打斷' },
};

function setState(name){
  const s = STATES[name];
  if (!s) return;
  document.body.className = name;
  statusText.textContent = s.text;
  statusDetail.textContent = s.detail;
}

// 預設展開時：thinking（之後接真實狀態）
setState('thinking');

// === ESC 收回浮窗 ===
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.api.collapseToFloating();
  }
});

// === 視窗控制 ===
document.getElementById('btnCollapse').addEventListener('click', () => {
  window.api.collapseToFloating();
});
document.getElementById('btnClose').addEventListener('click', () => {
  window.api.closeWindow();
});

// 之後語音層 / Claude 整合時：
//   setState(...) 更新中央狀態
//   updateConvo(...) 推入新訊息
//   updateTask(...) 更新右側任務面板
