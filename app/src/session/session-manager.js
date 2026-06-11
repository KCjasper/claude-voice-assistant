'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const MAX_TURNS = 50;
const MAX_TEXT_LENGTH = 20000;

function cleanText(value, max = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function blankData(idFactory) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: idFactory(),
    turns: [],
    activeTurn: null,
    state: 'idle',
    detail: '',
    working: null,
    tools: [],
    steps: [],
    usage: {},
    updatedAt: new Date().toISOString(),
  };
}

function migrateData(raw, idFactory) {
  if (raw?.schemaVersion === SCHEMA_VERSION && Array.isArray(raw.turns)) {
    return {
      ...blankData(idFactory),
      ...raw,
      turns: raw.turns.slice(-MAX_TURNS),
      tools: Array.isArray(raw.tools) ? raw.tools.filter((item) => typeof item === 'string') : [],
      steps: Array.isArray(raw.steps)
        ? raw.steps.map((step) => ({
            text: cleanText(step?.text, 200),
            status: ['running', 'done', 'interrupted'].includes(step?.status)
              ? step.status
              : 'done',
          }))
        : [],
    };
  }

  const legacyConvo = Array.isArray(raw?.convo) ? raw.convo : [];
  const turns = [];
  for (let index = 0; index < legacyConvo.length - 1; index += 1) {
    const user = legacyConvo[index];
    const assistant = legacyConvo[index + 1];
    if (user?.role !== 'you' || assistant?.role !== 'claude') continue;
    turns.push({
      id: idFactory(),
      user: cleanText(user.text),
      assistant: cleanText(assistant.text),
      model: '',
      usage: {},
      startedAt: null,
      completedAt: null,
    });
    index += 1;
  }
  return {
    ...blankData(idFactory),
    turns: turns.slice(-MAX_TURNS),
  };
}

class SessionManager {
  constructor({
    filePath,
    getWindows = () => [],
    fsImpl = fs,
    idFactory = () => crypto.randomUUID(),
    now = () => new Date(),
  }) {
    this.filePath = filePath;
    this.getWindows = getWindows;
    this.fs = fsImpl;
    this.idFactory = idFactory;
    this.now = now;
    this.data = this.load();
    if (this.data.activeTurn) {
      this.data.activeTurn = null;
      this.data.state = 'idle';
      this.data.detail = 'Previous request was interrupted by restart.';
      this.data.working = null;
      this.data.steps = this.data.steps.map((step) => (
        step.status === 'running' ? { ...step, status: 'interrupted' } : step
      ));
      this.persist();
    }
  }

  load() {
    try {
      if (!this.fs.existsSync(this.filePath)) return blankData(this.idFactory);
      const raw = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      return migrateData(raw, this.idFactory);
    } catch {
      return blankData(this.idFactory);
    }
  }

  persist() {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${this.idFactory()}.tmp`;
    this.data.updatedAt = this.now().toISOString();
    try {
      this.fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
      this.fs.renameSync(temp, this.filePath);
    } catch (error) {
      try { this.fs.unlinkSync(temp); } catch {}
      throw error;
    }
  }

  snapshot() {
    const convo = [];
    for (const turn of this.data.turns) {
      convo.push({ role: 'you', text: turn.user, turnId: turn.id });
      convo.push({ role: 'claude', text: turn.assistant, turnId: turn.id });
    }
    if (this.data.activeTurn) {
      convo.push({
        role: 'you',
        text: this.data.activeTurn.user,
        turnId: this.data.activeTurn.id,
      });
    }
    return {
      sessionId: this.data.sessionId,
      activeTurnId: this.data.activeTurn?.id || null,
      state: this.data.state,
      detail: this.data.detail,
      convo: convo.slice(-24),
      working: this.data.working,
      tools: [...this.data.tools],
      steps: this.data.steps.map((step) => ({ ...step })),
      usage: { ...this.data.usage },
      turnStart: this.data.activeTurn?.startedAt || 0,
      elapsedMs: this.data.activeTurn
        ? Math.max(0, this.now().getTime() - this.data.activeTurn.startedAt)
        : 0,
      updatedAt: this.data.updatedAt,
    };
  }

  broadcast({ persist = true } = {}) {
    if (persist) this.persist();
    const snapshot = this.snapshot();
    for (const window of this.getWindows()) {
      if (window.isDestroyed()) continue;
      try { window.webContents.send('session:state', snapshot); } catch {}
    }
    return snapshot;
  }

  startTurn(userText, { clientTurnId = null } = {}) {
    const turn = {
      id: this.idFactory(),
      clientTurnId: cleanText(clientTurnId, 200) || null,
      user: cleanText(userText),
      startedAt: this.now().getTime(),
    };
    this.data.activeTurn = turn;
    this.data.state = 'thinking';
    this.data.detail = 'Claude is thinking...';
    this.data.working = 'Claude is thinking...';
    this.data.tools = [];
    this.data.steps = [];
    this.broadcast();
    return turn;
  }

  progress(turnId, progress) {
    if (!this.data.activeTurn || this.data.activeTurn.id !== turnId) return this.snapshot();
    if (progress?.phase === 'tool' && typeof progress.name === 'string') {
      if (!this.data.tools.includes(progress.name)) this.data.tools.push(progress.name);
      this.data.steps = this.data.steps.map((step) => (
        step.status === 'running' ? { ...step, status: 'done' } : step
      ));
      this.data.steps.push({
        text: `Using ${cleanText(progress.name, 100)}`,
        status: 'running',
      });
      this.data.working = `Claude is using ${cleanText(progress.name, 100)}`;
      return this.broadcast();
    }
    if (progress?.phase === 'sentence') {
      this.data.state = 'speaking';
      this.data.working = null;
      return this.broadcast({ persist: false });
    }
    this.data.state = 'thinking';
    this.data.working = 'Claude is thinking...';
    return this.broadcast({ persist: false });
  }

  completeTurn(turnId, result) {
    const active = this.data.activeTurn;
    if (!active || active.id !== turnId) return this.snapshot();
    this.data.turns.push({
      id: active.id,
      clientTurnId: active.clientTurnId,
      user: active.user,
      assistant: cleanText(result?.text),
      model: cleanText(result?.model, 200),
      usage: {
        promptTokens: Number(result?.usage?.prompt_tokens) || 0,
        completionTokens: Number(result?.usage?.completion_tokens) || 0,
        costUsd: Number(result?.requestCost ?? result?.cost) || 0,
      },
      startedAt: active.startedAt,
      completedAt: this.now().getTime(),
    });
    this.data.turns = this.data.turns.slice(-MAX_TURNS);
    this.data.activeTurn = null;
    this.data.state = 'idle';
    this.data.detail = 'Completed';
    this.data.working = null;
    this.data.steps = this.data.steps.map((step) => (
      step.status === 'running' ? { ...step, status: 'done' } : step
    ));
    this.data.usage = {
      model: cleanText(result?.model, 200),
      tokens: Number(result?.usage?.total_tokens) || 0,
      cost: Number(result?.requestCost ?? result?.cost) || 0,
      todayUsd: Number(result?.usageSummary?.today?.usd) || 0,
      monthUsd: Number(result?.usageSummary?.month?.usd) || 0,
    };
    return this.broadcast();
  }

  failTurn(turnId, detail = 'Request failed') {
    if (!this.data.activeTurn || this.data.activeTurn.id !== turnId) return this.snapshot();
    this.data.activeTurn = null;
    this.data.state = 'idle';
    this.data.detail = cleanText(detail, 500);
    this.data.working = null;
    this.data.steps = this.data.steps.map((step) => (
      step.status === 'running' ? { ...step, status: 'interrupted' } : step
    ));
    return this.broadcast();
  }

  applyRendererSnapshot(snapshot) {
    if (this.data.activeTurn) return this.snapshot();
    const allowedStates = new Set(['idle', 'listening', 'speaking']);
    if (allowedStates.has(snapshot?.state)) this.data.state = snapshot.state;
    this.data.detail = cleanText(snapshot?.detail, 500);
    this.data.working = null;
    return this.broadcast();
  }

  conversationHistory() {
    return this.data.turns.flatMap((turn) => [
      { role: 'user', content: turn.user },
      { role: 'assistant', content: turn.assistant },
    ]).slice(-20);
  }

  reset() {
    this.data = blankData(this.idFactory);
    return this.broadcast();
  }
}

module.exports = {
  MAX_TURNS,
  SCHEMA_VERSION,
  SessionManager,
  migrateData,
};
