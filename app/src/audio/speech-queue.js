'use strict';

(function exposeSpeechQueue(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root) root.SpeechQueueController = exported.SpeechQueueController;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class SpeechQueueController {
    constructor({ synthesize, createPlayback, onSpeaking, sleep = defaultSleep }) {
      this.synthesize = synthesize;
      this.createPlayback = createPlayback;
      this.onSpeaking = onSpeaking || (() => {});
      this.sleep = sleep;
      this.generation = 0;
      this.queue = [];
      this.synthAhead = null;
      this.drainingGeneration = null;
      this.currentPlayback = null;
      this.spokeAnything = false;
    }

    reset() {
      this.generation += 1;
      this.queue = [];
      this.synthAhead = null;
      this.spokeAnything = false;
      if (this.currentPlayback) {
        try { this.currentPlayback.cancel(); } catch {}
        this.currentPlayback = null;
      }
      return this.generation;
    }

    enqueue(text) {
      if (!text) return;
      this.spokeAnything = true;
      this.queue.push(text);
      const generation = this.generation;
      if (this.drainingGeneration !== generation) {
        void this.drain(generation);
      }
    }

    busy(generation = this.generation) {
      return (
        this.generation === generation
        && (
          this.drainingGeneration === generation
          || this.queue.length > 0
          || Boolean(this.synthAhead)
          || Boolean(this.currentPlayback)
        )
      );
    }

    async waitForDrain(generation = this.generation) {
      while (this.generation === generation && this.busy(generation)) {
        await this.sleep(40);
      }
      if (this.generation !== generation) return false;
      await this.sleep(80);
      while (this.generation === generation && this.busy(generation)) {
        await this.sleep(40);
      }
      return this.generation === generation;
    }

    async drain(generation) {
      this.drainingGeneration = generation;
      try {
        while (
          this.generation === generation
          && (this.queue.length > 0 || this.synthAhead)
        ) {
          let text;
          let audioBase64;

          if (this.synthAhead) {
            ({ text } = this.synthAhead);
            audioBase64 = await this.synthAhead.promise;
            if (this.generation !== generation) return;
            this.synthAhead = null;
          } else {
            text = this.queue.shift();
            audioBase64 = await this.synthesize(text);
            if (this.generation !== generation) return;
          }

          if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.synthAhead = {
              text: next,
              promise: this.synthesize(next),
            };
          }

          if (!audioBase64 || this.generation !== generation) continue;
          this.onSpeaking(text);
          const playback = this.createPlayback(audioBase64);
          this.currentPlayback = playback;
          await playback.promise;
          if (this.currentPlayback === playback) this.currentPlayback = null;
          if (this.generation !== generation) return;
        }
      } finally {
        if (this.drainingGeneration === generation) {
          this.drainingGeneration = null;
        }
      }
    }
  }

  return { SpeechQueueController };
});
