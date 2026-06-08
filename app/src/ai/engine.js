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
  const prefs = store.loadPrefs();
  if (prefs.jarvisMode) return jarvisPrompt();
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

function jarvisPrompt() {
  return [
    "You are JARVIS, KC's personal AI assistant — a refined, calm, articulate AI with a British-butler manner, inspired by Iron Man's J.A.R.V.I.S.",
    'ALWAYS respond in English, even though KC will often speak to you in Chinese. KC is a Web3 / DeFi entrepreneur; you understand his Chinese perfectly and reply in polished English.',
    '',
    "You can read and write files in KC's workspace to actually get work done (writing articles, tweets, reports, organizing data).",
    '',
    'IMPORTANT — your replies are read aloud via text-to-speech, so:',
    '- Keep replies concise, conversational and natural. No markdown symbols, no long monologues.',
    "- Occasionally address him as 'sir' in the understated J.A.R.V.I.S. way, but do not overdo it.",
    '- If you produce longer content (a tweet, an article, a report), write the full content to a file with write_file, and only SPEAK a one-line summary, e.g. "I have drafted three versions and saved them to the outputs folder, sir. Shall I read one to you?"',
    '- If you need more information, ask in one concise sentence.',
    '',
    'File conventions: documents as .html (KC prefers HTML); project files under projects/<name>/; one-off outputs under outputs/. Be careful before overwriting existing files.',
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

// 粗略估算 token：中日韓字 ~1 token/字，其餘 ~1 token/4 字
function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[　-鿿぀-ヿ가-힯＀-￯]/g) || []).length;
  const rest = s.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

// 修正串流模式下 Claw Router 回報不準的 usage（常見 prompt_tokens≈1）
// 若回報值明顯低於本地估算，就改用估算值，避免成本被嚴重低估。
function reconcileUsage(usage, messages, replyText) {
  const promptText = (messages || [])
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')))
    .join('\n') + JSON.stringify(tools.schema);
  const estPrompt = estimateTokens(promptText);
  const estCompletion = estimateTokens(replyText);
  if (usage.prompt_tokens < estPrompt * 0.5) usage.prompt_tokens = estPrompt;
  if (usage.completion_tokens < estCompletion * 0.5) usage.completion_tokens = estCompletion;
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  usage.estimated = true; // 標記為估算值（前端可顯示「約」）
  return usage;
}

// 句子邊界：中文標點（單字元）或英文句點/問號/驚嘆號後接空白，或換行
const SENTENCE_BOUNDARY = /[。！？]|[!?]\s|\.\s|\n/g;

function emitSentences(bufferRef, onSentence) {
  let m;
  SENTENCE_BOUNDARY.lastIndex = 0;
  while ((m = SENTENCE_BOUNDARY.exec(bufferRef.buf)) !== null) {
    const end = m.index + m[0].length;
    const sentence = bufferRef.buf.slice(0, end).trim();
    bufferRef.buf = bufferRef.buf.slice(end);
    SENTENCE_BOUNDARY.lastIndex = 0;
    if (sentence) onSentence(sentence);
  }
}

// 串流一回合：邊收 content / tool_call deltas，邊把完整句子丟給 onSentence
async function streamOnce(client, params, onSentence) {
  let stream;
  try {
    stream = await client.chat.completions.create({
      ...params, stream: true, stream_options: { include_usage: true },
    });
  } catch (e) {
    // 有些情況不支援 stream_options，退回不帶該參數
    stream = await client.chat.completions.create({ ...params, stream: true });
  }

  let content = '';
  const bufferRef = { buf: '' };
  let usage = null;
  const toolCalls = [];

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      bufferRef.buf += delta.content;
      emitSentences(bufferRef, onSentence);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const i = tc.index ?? 0;
        if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
    }
  }

  if (bufferRef.buf.trim()) onSentence(bufferRef.buf.trim()); // 收尾
  return { content, tool_calls: toolCalls.filter(Boolean), usage };
}

/**
 * 跑一次對話（含 agent loop，串流）
 * @param {string} userText
 * @param {object} opts - { onProgress, model }
 * onProgress 事件：{phase:'thinking'} / {phase:'tool',name,args} / {phase:'sentence',text}
 * @returns {Promise<{ ok, text?, usage?, cost?, model?, error? }>}
 */
async function chat(userText, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  let client;
  try { client = getClient(); } catch (e) { return { ok: false, error: e.message }; }

  const prefs = store.loadPrefs();
  const model = opts.model || prefs.defaultModel || 'claude-sonnet-4-6';

  history.push({ role: 'user', content: userText });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

  const messages = [{ role: 'system', content: systemPrompt() }, ...history];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let fullText = '';

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      onProgress({ phase: 'thinking', iteration: i });

      const { content, tool_calls, usage: u } = await streamOnce(
        client,
        { model, messages, tools: tools.schema, tool_choice: 'auto' },
        (sentence) => { fullText += (fullText ? ' ' : '') + sentence; onProgress({ phase: 'sentence', text: sentence }); }
      );
      addUsage(usage, u);

      const assistantMsg = { role: 'assistant', content: content || '' };
      if (tool_calls.length) assistantMsg.tool_calls = tool_calls;
      messages.push(assistantMsg);
      history.push(assistantMsg);

      if (tool_calls.length > 0) {
        for (const tc of tool_calls) {
          let parsedArgs = {};
          try { parsedArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}
          onProgress({ phase: 'tool', name: tc.function.name, args: parsedArgs });
          const result = await tools.execute(tc.function.name, parsedArgs);
          const toolMsg = {
            role: 'tool', tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          };
          messages.push(toolMsg);
          history.push(toolMsg);
        }
        continue;
      }

      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
      const replyText = (content || fullText).trim();
      reconcileUsage(usage, messages, replyText);
      return { ok: true, text: replyText, usage, cost: computeCost(model, usage), model };
    }

    return { ok: false, error: `工具呼叫超過上限（${MAX_ITERATIONS} 次），可能卡住了`, usage };
  } catch (e) {
    const detail = e?.error?.message || e?.message || String(e);
    return { ok: false, error: `AI 呼叫失敗：${detail}` };
  }
}

module.exports = { chat, resetConversation };
