'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFile } = require('../src/ai/file-write');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-write-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('creates nested files atomically and returns metadata', (t) => {
  const root = workspace(t);
  const result = writeFile(root, {
    path: 'outputs/report.html',
    content: '<h1>Report</h1>',
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'WRITE_CREATED');
  assert.equal(result.overwritten, false);
  assert.equal(result.bytes, 15);
  assert.equal(fs.readFileSync(path.join(root, 'outputs', 'report.html'), 'utf8'), '<h1>Report</h1>');
  assert.match(result.written.sha256, /^[a-f0-9]{64}$/);
});

test('existing files return a conflict with metadata unless overwrite is explicit', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'notes.txt');
  fs.writeFileSync(target, 'original', 'utf8');

  const conflict = writeFile(root, { path: 'notes.txt', content: 'replacement' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'WRITE_CONFLICT');
  assert.equal(conflict.requiresOverwrite, true);
  assert.equal(conflict.existing.size, 8);
  assert.match(conflict.existing.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');

  const replaced = writeFile(root, {
    path: 'notes.txt',
    content: 'replacement',
    overwrite: true,
  });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.code, 'WRITE_OVERWRITTEN');
  assert.equal(replaced.previous.size, 8);
  assert.equal(fs.readFileSync(target, 'utf8'), 'replacement');
});

test('rename failure preserves the original and removes temporary files', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'important.txt');
  fs.writeFileSync(target, 'keep me', 'utf8');

  const result = writeFile(
    root,
    { path: 'important.txt', content: 'new content', overwrite: true },
    { renameImpl: () => { throw new Error('simulated rename failure'); } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WRITE_FAILED');
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep me');
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.endsWith('.tmp')),
    []
  );
});

test('inspection failures return a structured error without modifying the target', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'protected.txt');
  fs.writeFileSync(target, 'protected', 'utf8');
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = () => { throw new Error('access denied'); };

  const result = writeFile(
    root,
    { path: 'protected.txt', content: 'replacement', overwrite: true },
    { fsImpl }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WRITE_INSPECTION_FAILED');
  assert.equal(result.cause, 'access denied');
  assert.equal(fs.readFileSync(target, 'utf8'), 'protected');
});

test('rejects oversized and non-string content before touching the filesystem', (t) => {
  const root = workspace(t);

  const large = writeFile(
    root,
    { path: 'large.txt', content: '123456789' },
    { maxBytes: 8 }
  );
  assert.equal(large.code, 'WRITE_TOO_LARGE');
  assert.equal(fs.existsSync(path.join(root, 'large.txt')), false);

  const invalid = writeFile(root, { path: 'invalid.txt', content: Buffer.from('data') });
  assert.equal(invalid.code, 'WRITE_INVALID_CONTENT');
  assert.equal(fs.existsSync(path.join(root, 'invalid.txt')), false);
});

test('rejects traversal outside the workspace', (t) => {
  const root = workspace(t);
  const result = writeFile(root, { path: '../escaped.txt', content: 'blocked' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WRITE_PATH_OUTSIDE_WORKSPACE');
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escaped.txt')), false);
});

test('rejects absolute paths and Windows alternate data streams', (t) => {
  const root = workspace(t);
  const absolute = writeFile(root, {
    path: path.join(root, 'absolute.txt'),
    content: 'blocked',
  });
  assert.equal(absolute.code, 'WRITE_INVALID_PATH');

  if (process.platform === 'win32') {
    const alternateStream = writeFile(root, {
      path: 'document.txt:hidden',
      content: 'blocked',
    });
    assert.equal(alternateStream.code, 'WRITE_INVALID_PATH');
  }
});

test('rejects symlink targets and parent directories that escape the workspace', (t) => {
  const root = workspace(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  const targetLink = path.join(root, 'linked-file.txt');
  const outsideFile = path.join(outside, 'outside.txt');
  fs.writeFileSync(outsideFile, 'outside', 'utf8');

  try {
    fs.symlinkSync(outsideFile, targetLink, 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('File symlinks require elevated Windows privileges.');
      return;
    }
    throw error;
  }

  const linkedFile = writeFile(root, {
    path: 'linked-file.txt',
    content: 'blocked',
    overwrite: true,
  });
  assert.equal(linkedFile.code, 'WRITE_SYMLINK_BLOCKED');
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');

  const directoryLink = path.join(root, 'linked-dir');
  try {
    fs.symlinkSync(outside, directoryLink, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Directory links require elevated Windows privileges.');
      return;
    }
    throw error;
  }

  const escapedParent = writeFile(root, {
    path: 'linked-dir/escaped.txt',
    content: 'blocked',
  });
  assert.equal(escapedParent.code, 'WRITE_PATH_OUTSIDE_WORKSPACE');
  assert.equal(fs.existsSync(path.join(outside, 'escaped.txt')), false);
});
