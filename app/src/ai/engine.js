// src/ai/engine.js — AI 引擎（透過 Claw Router，OpenAI 相容）
// 自寫 agent loop：呼叫模型 → 執行 tool calls → 回傳結果 → 迭代 → 得到最終回覆

const OpenAI = require('openai');
const store = require('../config/store');
const tools = require('./tools');

const MAX_ITERATIONS = 8;
const MAX_HISTORY = 20; // 保留最近幾則對話（控制 token 成本）

// 粗略價格表（USD / 百萬 token）：input, output。僅供估算，實際以 Claw Router 帳單為準。
// 找不到的 model 就只回報 token 數、不算錢。
const PRICE = {
  'claude-sonnet-4-6':            { in: 3,  out: 15 },
  'claude-sonnet-4-5-20250929':   { in: 3,  out: 15 },
  'claude-sonnet-4-20250514':     { in: 3,  out: 15 },
  'claude-opus-4-8':              { in: 15, out: 75 },
  'claude-opus-4-7':              { in: 15, out: 75 },
  'claude-opus-4-6':              { in: 15, out: 75 },
  'gemini-2.5-flash':             { in: 0.3, out: 2.5 },
};

function systemPrompt() {
  return [
    '你是 KC 的個人語音助理，名字叫 Claude。KC 是 Web3 / DeFi 領域的創業者，請一律用繁體中文溝通。',
    '',
    '你可以讀寫 KC 工作資料夾裡的檔案，來真正幫他完成工作（寫文章、推文、報告、整理資料）。',
    '',
    '【非常重要】你的回覆會被「念出來」給 KC 聽，所以：',
    '- 回覆要簡潔、口語、自然，不要用 markdown 符號（星號、井號、清單符號），不要長篇大論。',
    '- 如果產出比較長的內容（推文、文章、報告），請用 write_file 把完整內容寫進檔案，',
    '  然後「念出來」的只說一句摘要，例如「我寫好三個版本的推文，存到 outputs 資料夾了，要我念哪個給你聽？」',
    '- 需要更多資訊才能做時，直接用一句話問清楚。',
    '',
    '【檔案慣例】',
    '- 文件類產出一律用 HTML 格式（.html），這是 KC 的偏好。',
    '- 跟某個專案相關的檔案放 projects/專案名稱/ 底下；一次性的產出放 outputs/。',
    '- 覆蓋既有檔案前要謹慎；不確定就先問。',
  ].join('\n');
}

let history = [];

function getClient() {
  const key = store.loadApiKey();
  if (!key) throw new Error('尚未設定 API Key，請到 ⚙ 設定填入');
  const prefs = store.loadPrefs();
  return new OpenAI({ apiKey: key, baseURL: prefs.baseUrl });
}

function resetConversation() { history = []; }

function addUsage(acc, usage) {
  if (!usage) return;
  acc.prompt_tokens += usage.prompt_tokens || 0;
  acc.completion_tokens += usage.completion_tokens || 0;
  acc.total_tokens += usage.total_tokens || 0;
}

function computeCost(model, usage) {
  const p = PRICE[model];
  if (!p) return null;
  return (usage.prompt_tokens / 1e6) * p.in + (usage.completion_tokens / 1e6) * p.out;
}

/**
 * 跑一次對話（含 agent loop）
 * @param {string} userText
 * @param {object} opts - { onProgress, model }
 * @returns {Promise<{ ok, text?, usage?, cost?, model?, error? }>}
 */
async function chat(userText, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  let client;
  try { client = getClient(); } catch (e) { return { ok: false, error: e.message }; }

  const prefs = store.loadPrefs();
  const model = opts.model || prefs.defaultModel || 'anthropic/claude-sonnet-4';

  history.push({ role: 'user', content: userText });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

  const messages = [{ role: 'system', content: systemPrompt() }, ...history];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      onProgress({ phase: 'thinking', iteration: i });

      const res = await client.chat.completions.create({
        model,
        messages,
        tools: tools.schema,
        tool_choice: 'auto',
      });

      addUsage(usage, res.usage);
      const msg = res.choices?.[0]?.message;
      if (!msg) return { ok: false, error: '模型沒有回覆' };

      messages.push(msg);
      history.push(msg);

      // 有 tool calls → 逐一執行，把結果回灌
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}
          onProgress({ phase: 'tool', name: tc.function.name, args: parsedArgs });

          const result = await tools.execute(tc.function.name, parsedArgs);
          const toolMsg = {
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          };
          messages.push(toolMsg);
          history.push(toolMsg);
        }
        continue; // 再問模型一次
      }

      // 沒有 tool calls → 最終回覆
      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
      return {
        ok: true,
        text: (msg.content || '').trim(),
        usage,
        cost: computeCost(model, usage),
        model,
      };
    }

    return { ok: false, error: `工具呼叫超過上限（${MAX_ITERATIONS} 次），可能卡住了`, usage };
  } catch (e) {
    // OpenAI SDK 的錯誤通常帶 status / message
    const detail = e?.error?.message || e?.message || String(e);
    return { ok: false, error: `AI 呼叫失敗：${detail}` };
  }
}

module.exports = { chat, resetConversation };
