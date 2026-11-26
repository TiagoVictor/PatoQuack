// Detecta quem está falando medindo o volume (RMS) de cada stream com um AnalyserNode.
// Os analisadores não são ligados ao destination: o som remoto toca pelo <audio>, e o local não
// é reproduzido (evita ouvir a própria voz).

import { SPEAKING_HOLD_MS, SPEAKING_THRESHOLD } from './config.js';

const POLL_MS = 100;

export class SpeakingDetector {
  /**
   * @param {AudioContext} audioContext
   * @param {(id: string, speaking: boolean) => void} onChange
   */
  constructor(audioContext, onChange) {
    this.ctx = audioContext;
    this.onChange = onChange;
    /** @type {Map<string, {source: MediaStreamAudioSourceNode, analyser: AnalyserNode, buffer: Float32Array, speaking: boolean, lastLoudAt: number}>} */
    this.entries = new Map();
    // setInterval em vez de requestAnimationFrame: rAF para quando a aba fica em segundo plano.
    this.timer = setInterval(() => this.#tick(), POLL_MS);
  }

  watch(id, stream) {
    this.unwatch(id);
    if (stream.getAudioTracks().length === 0) return;

    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    this.entries.set(id, {
      source,
      analyser,
      buffer: new Float32Array(analyser.fftSize),
      speaking: false,
      lastLoudAt: 0,
    });
  }

  unwatch(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.source.disconnect();
    this.entries.delete(id);
    if (entry.speaking) this.onChange(id, false);
  }

  stop() {
    clearInterval(this.timer);
    for (const id of [...this.entries.keys()]) this.unwatch(id);
  }

  #tick() {
    const now = performance.now();
    for (const [id, entry] of this.entries) {
      entry.analyser.getFloatTimeDomainData(entry.buffer);
      let sum = 0;
      for (const sample of entry.buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / entry.buffer.length);

      if (rms > SPEAKING_THRESHOLD) entry.lastLoudAt = now;
      const speaking = now - entry.lastLoudAt < SPEAKING_HOLD_MS;

      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        this.onChange(id, speaking);
      }
    }
  }
}
