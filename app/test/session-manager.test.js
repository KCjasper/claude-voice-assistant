'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MAX_TURNS,
  SessionManager,
} = require('../src/session/session-manager');

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-assistant-session-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'session.json');
  let id = 0;
  let now = 1000;
  const sent = [];
  const manager = new SessionManager({
    filePath,
    idFactory: () => `id-${++id}`,
    now: () => new Date(now),
    getWindows: () => options.windows || [{
      isDestroyed: () => false,
      webContents: {
        send: (channel, payload) => sent.push({ channel, payload }),
      },
    }],
  });
  return {
    filePath,
    manager,
    sent,
    setNow: (value) => { now = value; },
  };
}

test('persists completed turns and restores engine-safe history after restart', (t) => {
  const ctx = setup(t);
  const turn = ctx.manager.startTurn('hello', { clientTurnId: 'renderer-1' });
  ctx.setNow(2000);
  ctx.manager.completeTurn(turn.id, {
    text: 'hi',
    model: 'claude-sonnet-4-6',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    requestCost: 0.01,
  });

  const restored = new SessionManager({
    filePath: ctx.filePath,
    idFactory: () => 'restored-id',
    now: () => new Date(3000),
  });

  assert.deepEqual(restored.conversationHistory(), [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ]);
  assert.equal(restored.snapshot().convo.length, 2);
});

test('sanitizes tool progress and never persists arguments or results', (t) => {
  const ctx = setup(t);
  const turn = ctx.manager.startTurn('inspect files');
  ctx.manager.progress(turn.id, {
    phase: 'tool',
    name: 'read_file',
    args: { path: 'secret/private.txt', token: 'credential' },
    result: 'sensitive contents',
  });

  const persisted = fs.readFileSync(ctx.filePath, 'utf8');
  assert.match(persisted, /read_file/);
  assert.doesNotMatch(persisted, /secret\/private|credential|sensitive contents/);
});

test('restart clears an active turn and marks running steps interrupted', (t) => {
  const ctx = setup(t);
  const turn = ctx.manager.startTurn('unfinished');
  ctx.manager.progress(turn.id, { phase: 'tool', name: 'web_search', args: { query: 'private' } });

  const restored = new SessionManager({
    filePath: ctx.filePath,
    idFactory: () => 'restart',
  });
  const snapshot = restored.snapshot();

  assert.equal(snapshot.activeTurnId, null);
  assert.equal(snapshot.state, 'idle');
  assert.match(snapshot.detail, /interrupted by restart/i);
  assert.equal(snapshot.steps[0].status, 'interrupted');
});

test('broadcasts authoritative snapshots to every live window', (t) => {
  const sent = [];
  const live = {
    isDestroyed: () => false,
    webContents: { send: (channel) => sent.push(channel) },
  };
  const destroyed = {
    isDestroyed: () => true,
    webContents: { send: () => sent.push('destroyed') },
  };
  const ctx = setup(t, { windows: [live, destroyed] });

  const turn = ctx.manager.startTurn('hello');
  ctx.manager.completeTurn(turn.id, { text: 'hi' });

  assert.deepEqual(sent, ['session:state', 'session:state']);
});

test('retains only completed turns and ignores renderer conversation injection', (t) => {
  const ctx = setup(t);
  for (let index = 0; index < MAX_TURNS + 5; index += 1) {
    const turn = ctx.manager.startTurn(`user-${index}`);
    ctx.manager.completeTurn(turn.id, { text: `assistant-${index}` });
  }

  ctx.manager.applyRendererSnapshot({
    state: 'idle',
    detail: 'renderer detail',
    convo: [{ role: 'you', text: 'injected secret' }],
    tools: ['write_file'],
  });

  const snapshot = ctx.manager.snapshot();
  assert.equal(snapshot.convo.length, 24);
  assert.equal(ctx.manager.conversationHistory().length, 20);
  assert.equal(
    ctx.manager.conversationHistory().some((message) => message.content === 'injected secret'),
    false
  );
});
