'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const cancellation = require('../src/tasks/cancellation');

const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => process.cwd() },
      safeStorage: { isEncryptionAvailable: () => false },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const tools = require('../src/ai/tools');
Module._load = originalLoad;

test('agent tools reject cancellation before performing work', async () => {
  const controller = new AbortController();
  controller.abort(cancellation.createAbortError());

  await assert.rejects(
    tools.execute('read_file', { path: 'README.md' }, { signal: controller.signal }),
    (error) => cancellation.isAbortError(error)
  );
});
