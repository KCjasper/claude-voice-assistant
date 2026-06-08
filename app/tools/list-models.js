// tools/list-models.js — 一次性：列出 Claw Router 帳號可用的模型 ID
// 用 Electron 跑（才能用 safeStorage 解密 Key），結果寫到 temp 檔
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.setName('voice-assistant'); // 確保 userData 指到正確資料夾
const store = require('../src/config/store');

const OUT = path.join(app.getPath('temp'), 'voice-assistant-models.txt');

app.whenReady().then(async () => {
  const lines = [];
  try {
    const key = store.loadApiKey();
    const prefs = store.loadPrefs();
    if (!key) { lines.push('NO_KEY：尚未儲存 API Key'); }
    else {
      lines.push('baseURL = ' + prefs.baseUrl);
      const res = await fetch(prefs.baseUrl + '/models', { headers: { Authorization: 'Bearer ' + key } });
      lines.push('HTTP ' + res.status);
      const data = await res.json();
      const ids = (data.data || data.models || []).map((m) => m.id || m.name || JSON.stringify(m));
      const claude = ids.filter((id) => /claude|sonnet|haiku|opus/i.test(id));
      const gpt = ids.filter((id) => /gpt|o1|o3|o4/i.test(id));
      lines.push('=== 全部模型數：' + ids.length + ' ===');
      lines.push('--- Claude 系 ---');
      lines.push(claude.join('\n') || '(無)');
      lines.push('--- GPT 系 ---');
      lines.push(gpt.join('\n') || '(無)');
      lines.push('--- 前 40 個全部 ---');
      lines.push(ids.slice(0, 40).join('\n'));
    }
  } catch (e) {
    lines.push('ERROR: ' + (e && e.message));
  }
  try { fs.writeFileSync(OUT, lines.join('\n'), 'utf-8'); } catch {}
  app.quit();
});
