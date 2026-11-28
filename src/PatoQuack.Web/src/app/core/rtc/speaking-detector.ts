const POLL_MS = 100;

interface Entry {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  speaking: boolean;
  lastLoudAt: number;
}

/**
 * Detecta quem está falando medindo o volume (RMS) de cada stream com um AnalyserNode.
 * Os analisadores não são ligados ao destination: o som remoto toca pelo <audio>, e o local
 * não é reproduzido (evita ouvir a própria voz).
 */
export class SpeakingDetector {
  private readonly entries = new Map<string, Entry>();
  // setInterval em vez de requestAnimationFrame: rAF para quando a aba fica em segundo plano.
  private readonly timer = setInterval(() => this.tick(), POLL_MS);

  constructor(
    private readonly context: AudioContext,
    private readonly threshold: number,
    private readonly holdMs: number,
    private readonly onChange: (id: string, speaking: boolean) => void,
  ) {}

  watch(id: string, stream: MediaStream): void {
    this.unwatch(id);
    if (stream.getAudioTracks().length === 0) return;

    const source = this.context.createMediaStreamSource(stream);
    const analyser = this.context.createAnalyser();
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

  unwatch(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.source.disconnect();
    this.entries.delete(id);
    if (entry.speaking) this.onChange(id, false);
  }

  stop(): void {
    clearInterval(this.timer);
    for (const id of [...this.entries.keys()]) this.unwatch(id);
  }

  private tick(): void {
    const now = performance.now();
    for (const [id, entry] of this.entries) {
      entry.analyser.getFloatTimeDomainData(entry.buffer);
      let sum = 0;
      for (const sample of entry.buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / entry.buffer.length);

      if (rms > this.threshold) entry.lastLoudAt = now;
      const speaking = now - entry.lastLoudAt < this.holdMs;

      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        this.onChange(id, speaking);
      }
    }
  }
}
