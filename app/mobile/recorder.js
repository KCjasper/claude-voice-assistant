// recorder.js — 手機端麥克風錄音 → 16kHz mono PCM WAV
// 移植桌面 src/audio/recorder.js 的 WAV 打包，並加上 iOS Safari 處理：
//   iOS 不允許自訂 AudioContext sampleRate，故用裝置原生取樣率錄，停止時線性 resample 到 16k。
// 後端 stt.transcribe 要求 RIFF/WAVE，max 8MB（見 app/src/remote/PROTOCOL.md）。

class WavRecorder {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    this.recording = false;
    this.chunks = [];
    this.sourceSampleRate = 16000;   // 實際錄音取樣率（由 AudioContext 決定）
    this.targetSampleRate = 16000;   // Whisper 要的取樣率
    this.maxSeconds = 60;
    this.onLevel = null;             // (rms) => void，給 UI 音波
    this.onMaxReached = null;        // () => void，達上限自動停
    this.onError = null;
    this._maxTriggered = false;
  }

  async start() {
    if (this.recording) return;
    this.chunks = [];
    this._maxTriggered = false;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      if (this.onError) this.onError(e);
      throw e;
    }

    // iOS Safari 會忽略/拒絕自訂 sampleRate → 不指定，改用裝置原生，停止時自己 resample。
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new Ctx();
    // iOS 需在使用者手勢內 resume
    if (this.audioContext.state === 'suspended') {
      try { await this.audioContext.resume(); } catch {}
    }
    this.sourceSampleRate = this.audioContext.sampleRate || 48000;
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.source.connect(this.processor);
    // 接 gain=0 → destination，processor 才會跑但不發聲
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      if (this.onLevel) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        this.onLevel(Math.sqrt(sum / input.length));
      }
      if (!this._maxTriggered && this.durationSeconds() >= this.maxSeconds) {
        this._maxTriggered = true;
        if (this.onMaxReached) this.onMaxReached();
      }
    };

    this.recording = true;
  }

  async stop() {
    if (!this.recording) return null;
    this.recording = false;

    try { this.processor.disconnect(); } catch {}
    try { this.source.disconnect(); } catch {}
    try { this.silentGain.disconnect(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioContext) { try { await this.audioContext.close(); } catch {} }

    const totalLen = this.chunks.reduce((s, c) => s + c.length, 0);
    if (totalLen === 0) return null;
    let merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of this.chunks) { merged.set(c, offset); offset += c.length; }

    // 非 16k → 線性 resample 到 16k（iOS 等裝置原生多為 44.1k/48k）
    if (this.sourceSampleRate !== this.targetSampleRate) {
      merged = this._resample(merged, this.sourceSampleRate, this.targetSampleRate);
    }

    // Float32 → Int16
    const int16 = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return this._makeWav(int16, this.targetSampleRate);
  }

  isRecording() { return this.recording; }

  durationSeconds() {
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    return total / this.sourceSampleRate;
  }

  _resample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.round(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  // RIFF / PCM 16-bit mono → ArrayBuffer
  _makeWav(int16, sampleRate) {
    const dataBytes = int16.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(int16.buffer));
    return buffer;
  }
}

window.WavRecorder = WavRecorder;
