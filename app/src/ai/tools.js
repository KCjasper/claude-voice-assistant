// src/ai/tools.js — 給 Claude 用的工具（OpenAI function-calling 格式）
// 所有檔案操作都限制在工作資料夾內，防止路徑逃逸

const fs = require('fs');
const path = require('path');
const store = require('../config/store');
const search = require('./search');
const cancellation = require('../tasks/cancellation');
const urlFetch = require('./url-fetch');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function isInsideRoot(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function normalizeRoot(p) {
  return path.resolve(p);
}

// 工作資料夾根目錄預設為 repo root；prefs.workspaceDir 只能縮小到 repo 內。
function workspaceRoot() {
  const prefs = store.loadPrefs();
  const root = normalizeRoot(PROJECT_ROOT);
  if (prefs.workspaceDir) {
    const configured = normalizeRoot(prefs.workspaceDir);
    if (fs.existsSync(configured) && isInsideRoot(root, configured)) return configured;
  }
  return root;
}

// 把使用者給的相對/絕對路徑解析成「保證在工作資料夾內」的絕對路徑
function safeResolve(p) {
  const root = workspaceRoot();
  const resolved = path.resolve(root, p || '.');
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路徑超出工作資料夾範圍：${p}`);
  }
  return resolved;
}

// ===== 工具的 JSON schema（給模型看的）=====
const schema = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '讀取工作資料夾內某個文字檔的內容。用於參考既有專案、文件、設定。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相對於工作資料夾的檔案路徑，例如 projects/voice-assistant/plan.html' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在工作資料夾內寫入/覆蓋一個檔案。產出文件（文章、報告）一律用 .html。會自動建立需要的資料夾。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相對於工作資料夾的檔案路徑，例如 outputs/tweet-2026-06-08.html' },
          content: { type: 'string', description: '完整檔案內容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出工作資料夾內某個目錄的檔案與子目錄。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相對於工作資料夾的目錄路徑，留空代表根目錄' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '抓取一個網頁的純文字內容，用於研究、查資料。只支援 http/https。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整網址，含 https://' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '在網路上搜尋即時資訊（新聞、資料、查證）。回傳前幾筆結果的標題、網址、摘要。需要更詳細內容時可再用 fetch_url 抓該網址。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜尋關鍵字' },
          count: { type: 'number', description: '要幾筆結果，預設 5，最多 10' },
        },
        required: ['query'],
      },
    },
  },
];

// ===== 工具實作 =====

function readFile(args) {
  const fp = safeResolve(args.path);
  if (!fs.existsSync(fp)) return `錯誤：找不到檔案 ${args.path}`;
  const stat = fs.statSync(fp);
  if (stat.size > 500 * 1024) return `錯誤：檔案過大（${(stat.size / 1024).toFixed(0)}KB），請改讀較小的檔案`;
  return fs.readFileSync(fp, 'utf-8');
}

function writeFile(args) {
  const fp = safeResolve(args.path);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, args.content ?? '', 'utf-8');
  return `已寫入：${args.path}（${Buffer.byteLength(args.content ?? '', 'utf-8')} bytes）`;
}

function listDirectory(args) {
  const dp = safeResolve(args.path || '.');
  if (!fs.existsSync(dp)) return `錯誤：找不到目錄 ${args.path}`;
  const entries = fs.readdirSync(dp, { withFileTypes: true });
  const lines = entries.map((e) => (e.isDirectory() ? `[資料夾] ${e.name}` : `        ${e.name}`));
  return lines.join('\n') || '（空目錄）';
}

// ===== 統一派發 =====
async function execute(name, args, opts = {}) {
  try {
    cancellation.throwIfAborted(opts.signal);
    switch (name) {
      case 'read_file': return readFile(args);
      case 'write_file': return writeFile(args);
      case 'list_directory': return listDirectory(args);
      case 'fetch_url': return await urlFetch.fetchUrl(args.url, opts);
      case 'web_search': return await search.webSearch(args.query, args.count || 5, opts);
      default: return `錯誤：未知的工具 ${name}`;
    }
  } catch (e) {
    if (cancellation.isAbortError(e) || opts.signal?.aborted) throw e;
    return `錯誤：${e.message}`;
  }
}

module.exports = { schema, execute, workspaceRoot };
