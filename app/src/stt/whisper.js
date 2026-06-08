const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const setup = require('./setup');

const DEFAULT_MODEL = 'medium-q5';
const MIN_TRANSCRIBE_TIMEOUT_MS = 90 * 1000;
const MAX_TRANSCRIBE_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_PER_AUDIO_SECOND_MS = 15 * 1000;

function wavDurationSec(wavPath) {
  try {
    const fd = fs.openSync(wavPath, 'r');
    try {
      const header = Buffer.alloc(44);
      const bytes = fs.readSync(fd, header, 0, header.length, 0);
      if (bytes < 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
        return null;
      }

      const channels = header.readUInt16LE(22);
      const sampleRate = header.readUInt32LE(24);
      const bitsPerSample = header.readUInt16LE(34);
      const dataBytes = header.readUInt32LE(40);
      const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
      if (!bytesPerSecond || !Number.isFinite(bytesPerSecond)) return null;
      return dataBytes / bytesPerSecond;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function transcribeTimeoutMs(wavPath, explicitTimeoutMs) {
  if (Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) return explicitTimeoutMs;

  const duration = wavDurationSec(wavPath);
  if (!duration) return MIN_TRANSCRIBE_TIMEOUT_MS;

  return Math.min(
    MAX_TRANSCRIBE_TIMEOUT_MS,
    Math.max(MIN_TRANSCRIBE_TIMEOUT_MS, Math.ceil(duration * TIMEOUT_PER_AUDIO_SECOND_MS))
  );
}

async function transcribe(wavPath, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const language = opts.language || 'zh';
  const onProgress = opts.onProgress || (() => {});
  let gpu = opts.gpu !== false;

  try {
    if (!fs.existsSync(wavPath)) return { ok: false, error: `Audio file not found: ${wavPath}` };

    onProgress({ phase: 'ensure-binary', gpu });
    let exe;
    try {
      exe = await setup.ensureBinary(onProgress, gpu);
    } catch (e) {
      if (gpu) {
        gpu = false;
        onProgress({ phase: 'gpu-fallback', error: e.message });
        exe = await setup.ensureBinary(onProgress, false);
      } else {
        throw e;
      }
    }

    onProgress({ phase: 'ensure-model', model });
    const modelPath = await setup.ensureModel(model, onProgress);

    onProgress({ phase: 'transcribe', gpu });
    const t0 = Date.now();
    const timeoutMs = transcribeTimeoutMs(wavPath, opts.timeoutMs);
    let text;

    try {
      text = await runWhisper(exe, modelPath, wavPath, {
        language,
        prompt: opts.prompt,
        timeoutMs,
      });
    } catch (e) {
      if (gpu) {
        gpu = false;
        onProgress({ phase: 'gpu-fallback', error: e.message });
        const cpuExe = await setup.ensureBinary(onProgress, false);
        text = await runWhisper(cpuExe, modelPath, wavPath, {
          language,
          prompt: opts.prompt,
          timeoutMs,
        });
      } else {
        throw e;
      }
    }

    return { ok: true, text, ms: Date.now() - t0, gpu };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function runWhisper(exe, modelPath, wavPath, { language, prompt, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-l', language,
      '--no-prints',
      '--output-txt',
      '-of', wavPath.replace(/\.wav$/i, ''),
    ];
    if (prompt) args.push('--prompt', prompt);

    const child = spawn(exe, args, {
      cwd: path.dirname(exe),
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const tail = (s, n = 800) => s.slice(-n);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(
        reject,
        new Error(`whisper timed out after ${Math.round(timeoutMs / 1000)}s: ${tail(stderr) || tail(stdout) || 'no output'}`)
      );
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => finish(reject, new Error(`Failed to start whisper: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        return finish(reject, new Error(`whisper exit ${code}: ${tail(stderr, 400) || tail(stdout, 400)}`));
      }

      const txtPath = wavPath.replace(/\.wav$/i, '.txt');
      try {
        if (fs.existsSync(txtPath)) {
          const text = fs.readFileSync(txtPath, 'utf-8').trim();
          if (text) return finish(resolve, text);
        }
      } catch {}

      finish(resolve, cleanStdout(stdout));
    });
  });
}

function cleanStdout(stdout) {
  const lines = stdout.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const m = line.match(/\]\s*(.+)$/);
    if (m) out.push(m[1].trim());
    else if (line.trim() && !line.startsWith('whisper_') && !line.includes('system_info')) {
      out.push(line.trim());
    }
  }
  return out.join(' ').trim();
}

module.exports = { transcribe, transcribeTimeoutMs, wavDurationSec };
