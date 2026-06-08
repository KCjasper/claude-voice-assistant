// usage-util.js — 前端用量計算工具（floating 與 settings 兩個視窗共用）
// 用量資料存在 prefs.usage，靠既有 getPrefs/savePrefs IPC 持久化，不需後端改動
(function () {
  function pad(n) { return String(n).padStart(2, '0'); }
  // 用「本地時間」算日/月，避免 UTC 時區造成「今天」提早跳天
  function dayKey(d) { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function monthKey(d) { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

  function ensure(u) { u = u || {}; u.days = u.days || {}; u.months = u.months || {}; return u; }
  function blank() { return { usd: 0, prompt: 0, completion: 0, calls: 0 }; }

  // 把一次用量加進 usage 物件（回傳同一物件，已更新今天 + 本月）
  function addUsage(usage, entry) {
    const u = ensure(usage);
    const dk = dayKey(), mk = monthKey();
    u.days[dk] = u.days[dk] || blank();
    u.months[mk] = u.months[mk] || blank();
    for (const b of [u.days[dk], u.months[mk]]) {
      b.usd += entry.cost || 0;
      b.prompt += entry.promptTokens || 0;
      b.completion += entry.completionTokens || 0;
      b.calls += 1;
    }
    // 只保留最近 ~90 天，避免無限膨脹
    const days = Object.keys(u.days).sort();
    while (days.length > 90) delete u.days[days.shift()];
    return u;
  }

  function summary(usage) {
    const u = ensure(usage);
    return { today: u.days[dayKey()] || blank(), month: u.months[monthKey()] || blank() };
  }

  // 金額格式化：小額多顯示幾位小數，才看得到變化
  function fmtMoney(v) {
    v = v || 0;
    if (v > 0 && v < 0.1) return '$' + v.toFixed(3);
    return '$' + v.toFixed(2);
  }

  window.UsageUtil = { addUsage, summary, fmtMoney };
})();
