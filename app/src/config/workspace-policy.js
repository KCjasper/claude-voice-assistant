'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

class WorkspacePolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspacePolicyError';
    this.code = code;
    this.details = details;
  }
}

function comparablePath(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(a, b) {
  return comparablePath(a) === comparablePath(b);
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function defaultSystemPaths(env = process.env) {
  const candidates = process.platform === 'win32'
    ? [
        env.WINDIR,
        env.SystemRoot,
        env.ProgramFiles,
        env['ProgramFiles(x86)'],
        env.ProgramData,
        env.APPDATA,
        env.LOCALAPPDATA,
      ]
    : [
        '/bin',
        '/boot',
        '/dev',
        '/etc',
        '/Library',
        '/private',
        '/proc',
        '/root',
        '/run',
        '/sbin',
        '/System',
        '/sys',
        '/usr',
        '/var',
      ];
  return [...new Set(candidates.filter(Boolean).map((entry) => path.resolve(entry)))];
}

function validateWorkspaceCandidate(candidate, opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new WorkspacePolicyError('WORKSPACE_INVALID_PATH', 'A workspace path is required.');
  }

  const absolute = path.resolve(candidate);
  if (!fsImpl.existsSync(absolute)) {
    throw new WorkspacePolicyError('WORKSPACE_NOT_FOUND', 'The workspace folder does not exist.', {
      path: absolute,
    });
  }

  const stat = fsImpl.statSync(absolute);
  if (!stat.isDirectory()) {
    throw new WorkspacePolicyError('WORKSPACE_NOT_DIRECTORY', 'The workspace path is not a directory.', {
      path: absolute,
    });
  }

  const realPath = fsImpl.realpathSync(absolute);
  if (samePath(realPath, path.parse(realPath).root)) {
    throw new WorkspacePolicyError('WORKSPACE_DANGEROUS_ROOT', 'A filesystem root cannot be used as a workspace.', {
      path: realPath,
    });
  }

  const homeDir = path.resolve(opts.homeDir || os.homedir());
  if (samePath(realPath, homeDir)) {
    throw new WorkspacePolicyError(
      'WORKSPACE_DANGEROUS_HOME',
      'The home directory itself cannot be used as a workspace. Select a project folder inside it.',
      { path: realPath }
    );
  }

  const systemPaths = opts.systemPaths || defaultSystemPaths(opts.env);
  const blockedSystemPath = systemPaths.find((blocked) => {
    const resolved = path.resolve(blocked);
    return samePath(realPath, resolved) || isInsideRoot(resolved, realPath);
  });
  if (blockedSystemPath) {
    throw new WorkspacePolicyError(
      'WORKSPACE_DANGEROUS_SYSTEM',
      'System and application-data directories cannot be used as workspaces.',
      { path: realPath, blockedBy: path.resolve(blockedSystemPath) }
    );
  }

  return {
    path: realPath,
    name: path.basename(realPath),
  };
}

function normalizeApprovedFolders(entries) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)) continue;
    const absolute = path.normalize(entry.path);
    if (normalized.some((item) => samePath(item.path, absolute))) continue;
    normalized.push({
      path: absolute,
      name: typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : path.basename(absolute),
    });
  }
  return normalized;
}

function findApprovedFolder(entries, candidate) {
  const absolute = path.resolve(candidate);
  return normalizeApprovedFolders(entries).find((entry) => samePath(entry.path, absolute)) || null;
}

function resolveActiveWorkspace(prefs, defaultRoot, opts = {}) {
  const trustedDefault = validateWorkspaceCandidate(defaultRoot, {
    ...opts,
    homeDir: opts.homeDir || os.homedir(),
    systemPaths: [],
  }).path;
  if (!prefs?.workspaceDir) return trustedDefault;

  const approved = findApprovedFolder(prefs.approvedFolders, prefs.workspaceDir);
  if (!approved) return trustedDefault;

  try {
    return validateWorkspaceCandidate(approved.path, opts).path;
  } catch {
    return trustedDefault;
  }
}

function resolveWorkspacePath(rootPath, requestedPath, opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  const allowRoot = opts.allowRoot === true;
  const mustExist = opts.mustExist !== false;
  const relativePath = requestedPath || '.';

  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new WorkspacePolicyError(
      'WORKSPACE_PATH_OUTSIDE',
      'File tools accept workspace-relative paths only.'
    );
  }
  if (process.platform === 'win32' && relativePath.includes(':')) {
    throw new WorkspacePolicyError(
      'WORKSPACE_PATH_OUTSIDE',
      'Windows alternate data stream paths are not allowed.'
    );
  }

  const root = fsImpl.realpathSync(path.resolve(rootPath));
  const lexicalTarget = path.resolve(root, relativePath);
  if (!isInsideRoot(root, lexicalTarget) || (!allowRoot && samePath(root, lexicalTarget))) {
    throw new WorkspacePolicyError(
      'WORKSPACE_PATH_OUTSIDE',
      'The requested path is outside the active workspace.'
    );
  }

  if (!mustExist) return lexicalTarget;
  if (!fsImpl.existsSync(lexicalTarget)) return lexicalTarget;

  const realTarget = fsImpl.realpathSync(lexicalTarget);
  if (!isInsideRoot(root, realTarget)) {
    throw new WorkspacePolicyError(
      'WORKSPACE_PATH_OUTSIDE',
      'The requested path resolves outside the active workspace.'
    );
  }
  return realTarget;
}

module.exports = {
  WorkspacePolicyError,
  defaultSystemPaths,
  findApprovedFolder,
  isInsideRoot,
  normalizeApprovedFolders,
  resolveActiveWorkspace,
  resolveWorkspacePath,
  samePath,
  validateWorkspaceCandidate,
};
