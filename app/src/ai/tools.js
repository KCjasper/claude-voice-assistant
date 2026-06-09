// src/ai/tools.js — 給 Claude 用的工具（OpenAI function-calling 格式）
// 所有檔案操作都限制在工作資料夾內，防止路徑逃逸

const fs = require('fs');
const store = require('../config/store');
const search = require('./search');
const cancellation = require('../tasks/cancellation');
const urlFetch = require('./url-fetch');
const fileWrite = require('./file-write');
const workspacePolicy = require('../config/workspace-policy');

function workspaceRoot() {
  return store.getWorkspaceState().workspaceDir;
}

function safeResolve(p, { allowRoot = false } = {}) {
  return workspacePolicy.resolveWorkspacePath(workspaceRoot(), p, {
    allowRoot,
    mustExist: true,
  });
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
      description: '在工作資料夾內安全建立檔案。既有檔案不會直接覆蓋；只有使用者明確要求替換時，才可帶 overwrite=true 重試。產出文件（文章、報告）一律用 .html。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相對於工作資料夾的檔案路徑，例如 outputs/tweet-2026-06-08.html' },
          content: { type: 'string', description: '完整檔案內容' },
          overwrite: {
            type: 'boolean',
            description: '既有檔案的明確覆寫確認。只有使用者要求替換時才設為 true；新檔不需要。',
          },
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

function listDirectory(args) {
  const dp = safeResolve(args.path || '.', { allowRoot: true });
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
      case 'write_file': return fileWrite.writeFile(workspaceRoot(), args);
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
