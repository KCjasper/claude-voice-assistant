'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findApprovedFolder,
  normalizeApprovedFolders,
  resolveActiveWorkspace,
  resolveWorkspacePath,
  validateWorkspaceCandidate,
} = require('../src/config/workspace-policy');

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('normalizes and deduplicates approved folder records', () => {
  const root = path.resolve('workspace-a');
  const folders = normalizeApprovedFolders([
    { path: root, name: 'Workspace A' },
    { path: root, name: 'Duplicate' },
    { path: 'relative/path', name: 'Invalid' },
    null,
  ]);

  assert.deepEqual(folders, [{ path: root, name: 'Workspace A' }]);
  assert.equal(findApprovedFolder(folders, root).name, 'Workspace A');
});

test('rejects filesystem root, home root and system directories', (t) => {
  const home = tempDir(t, 'voice-assistant-home-');
  const system = tempDir(t, 'voice-assistant-system-');

  assert.throws(
    () => validateWorkspaceCandidate(path.parse(home).root, { homeDir: home, systemPaths: [] }),
    { code: 'WORKSPACE_DANGEROUS_ROOT' }
  );
  assert.throws(
    () => validateWorkspaceCandidate(home, { homeDir: home, systemPaths: [] }),
    { code: 'WORKSPACE_DANGEROUS_HOME' }
  );
  assert.throws(
    () => validateWorkspaceCandidate(system, { homeDir: home, systemPaths: [system] }),
    { code: 'WORKSPACE_DANGEROUS_SYSTEM' }
  );
});

test('allows a project folder below home and returns its real path', (t) => {
  const home = tempDir(t, 'voice-assistant-home-');
  const project = path.join(home, 'Projects', 'Jarvis');
  fs.mkdirSync(project, { recursive: true });

  const validated = validateWorkspaceCandidate(project, {
    homeDir: home,
    systemPaths: [],
  });
  assert.equal(validated.path, fs.realpathSync(project));
  assert.equal(validated.name, 'Jarvis');
});

test('active workspace falls back unless the folder is approved and safe', (t) => {
  const defaultRoot = tempDir(t, 'voice-assistant-default-');
  const external = tempDir(t, 'voice-assistant-external-');
  const opts = { homeDir: path.dirname(defaultRoot), systemPaths: [] };

  assert.equal(
    resolveActiveWorkspace({ workspaceDir: external, approvedFolders: [] }, defaultRoot, opts),
    fs.realpathSync(defaultRoot)
  );
  assert.equal(
    resolveActiveWorkspace({
      workspaceDir: external,
      approvedFolders: [{ path: external, name: 'External' }],
    }, defaultRoot, opts),
    fs.realpathSync(external)
  );
});

test('workspace paths reject traversal and symlink escapes', (t) => {
  const root = tempDir(t, 'voice-assistant-root-');
  const outside = tempDir(t, 'voice-assistant-outside-');
  fs.writeFileSync(path.join(root, 'inside.txt'), 'inside', 'utf8');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret', 'utf8');

  assert.throws(
    () => resolveWorkspacePath(root, '../outside.txt'),
    { code: 'WORKSPACE_PATH_OUTSIDE' }
  );
  assert.equal(
    resolveWorkspacePath(root, 'inside.txt'),
    fs.realpathSync(path.join(root, 'inside.txt'))
  );

  const link = path.join(root, 'outside-link');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Directory links require elevated Windows privileges.');
      return;
    }
    throw error;
  }
  assert.throws(
    () => resolveWorkspacePath(root, 'outside-link/secret.txt'),
    { code: 'WORKSPACE_PATH_OUTSIDE' }
  );
});
