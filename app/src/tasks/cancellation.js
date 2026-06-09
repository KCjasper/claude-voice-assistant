'use strict';

const { randomUUID } = require('crypto');

function createAbortError(message = 'Task cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'CANCELLED';
  return error;
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'CANCELLED';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw isAbortError(signal.reason) ? signal.reason : createAbortError();
}

function timeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    controller.abort(
      isAbortError(parentSignal.reason) ? parentSignal.reason : createAbortError()
    );
  };

  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    const error = new Error(`Operation timed out after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    error.code = 'TIMEOUT';
    controller.abort(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

class TaskRegistry {
  constructor({ onState } = {}) {
    this.tasks = new Map();
    this.onState = onState || (() => {});
  }

  start(type, metadata = {}) {
    const id = randomUUID();
    const controller = new AbortController();
    const task = {
      id,
      type,
      controller,
      signal: controller.signal,
      metadata,
      startedAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.emit(task, 'running');
    return task;
  }

  finish(id, status = 'completed') {
    const task = this.tasks.get(id);
    if (!task) return false;
    this.tasks.delete(id);
    this.emit(task, status);
    return true;
  }

  cancel({ id, type } = {}) {
    const cancelled = [];
    for (const task of this.tasks.values()) {
      if (id && task.id !== id) continue;
      if (type && task.type !== type) continue;
      if (task.signal.aborted) continue;
      task.controller.abort(createAbortError());
      cancelled.push(task.id);
      this.emit(task, 'cancel-requested');
    }
    return cancelled;
  }

  hasType(type) {
    for (const task of this.tasks.values()) {
      if (task.type === type) return true;
    }
    return false;
  }

  emit(task, status) {
    this.onState({
      requestId: task.id,
      type: task.type,
      status,
      startedAt: task.startedAt,
    });
  }
}

function cancelledResult(requestId) {
  return {
    ok: false,
    code: 'CANCELLED',
    cancelled: true,
    requestId,
    error: 'Task cancelled.',
  };
}

module.exports = {
  TaskRegistry,
  cancelledResult,
  createAbortError,
  isAbortError,
  throwIfAborted,
  timeoutSignal,
};
