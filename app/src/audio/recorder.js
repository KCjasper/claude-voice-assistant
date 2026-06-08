// src/audio/recorder.js — 麥克風錄音模組（渲染端使用）
// 直接拿 16kHz 單聲道 PCM，打包成 Whisper 能吃的 WAV

class VoiceRecorder {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.recording = false;
    this.chunks = [];
    this.targetSampleRate = 16000;
    this.onLevel = null;       // callback: (rms) => void，給 UI 做音波視覺
    this.onError = null;       // callback: (Error) => void
  }

  async start() {
    if (this.recording) return;
    this.chunks = [];

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      if (this.onError) this.onError(e);
      throw e;
    }

    // AudioContext 設成 16k；瀏覽器會自動 resample 麥克風的 48k → 16k
    this.audioContext = new AudioContext({ sampleRate: this.targetSampleRate });
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // Analyser 用來算 RMS 做音波視覺
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);

    // ScriptProcessor 抓 PCM samples（簡單版；之後可改 AudioWorklet）
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.source.connect(this.processor);
    // 接到 gain=0 的節點再丟給 destination：processor 才會跑，但不會發聲
    this._silentGain = this.audioContext.createGain();
    this._silentGain.gain.value = 0;
    this.processor.connect(this._silentGain);
    this._silentGain.connect(this.audioContext.destination);

    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));

      // RMS for UI
      if (this.onLevel) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        this.onLevel(rms);
      }
    };

    this.recording = true;
  }

  async stop() {
    if (!this.recording) return null;
    this.recording = false;

    // 拆掉所有節點
    try { this.processor.disconnect(); } catch {}
    try { this.source.disconnect(); } catch {}
    try { this.analyser.disconnect(); } catch {}
    try { this._silentGain.disconnect(); } catch {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.audioContext) await this.audioContext.close();

    // 合併所有 chunks
    const totalLen = this.chunks.reduce((s, c) => s + c.length, 0);
    if (totalLen === 0) return null;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    // Float32 → Int16
    const int16 = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 包成 WAV
    return this._makeWav(int16, this.targetSampleRate);
  }

  isRecording() { return this.recording; }

  durationSeconds() {
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    return total / this.targetSampleRate;
  }

  // WAV header (RIFF / PCM 16-bit mono)
  _makeWav(int16, sampleRate) {
    const dataBytes = int16.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    const writeStr = (off, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);            // PCM chunk size
    view.setUint16(20, 1, true);             // format = PCM
    view.setUint16(22, 1, true);             // channels = 1
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);// byte rate
    view.setUint16(32, 2, true);             // block align
    view.setUint16(34, 16, true);            // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);

    // PCM payload
    new Uint8Array(buffer, 44).set(new Uint8Array(int16.buffer));
    return buffer;
  }
}

window.VoiceRecorder = VoiceRecorder;
