import { ChangeDetectionStrategy, Component, DestroyRef, inject, output, signal } from '@angular/core';
import { PeerStats } from '../../../core/rtc/mesh-voice-session';
import { Icon } from '../../../shared/ui';
import { VoiceRoomStore } from '../data/voice-room.store';

const INTERVAL_MS = 2000;
const LIMITATION: Record<string, string> = { none: 'nenhum', cpu: 'CPU', bandwidth: 'banda', other: 'outro' };

interface PeerRow {
  id: string;
  name: string;
  out: string;
  in: string;
  sending: boolean;
}

const mbps = (bps: number) => `${(bps / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })} Mbps`;
const rate = (bytes: number, prev: number, dtMs: number) => (dtMs > 0 ? Math.max(0, ((bytes - prev) * 8 * 1000) / dtMs) : 0);
const size = (s?: { width?: number; height?: number } | null) => (s?.width && s?.height ? `${s.width}×${s.height}` : null);
const fps = (s?: { fps?: number } | null) => (s?.fps !== undefined ? `${Math.round(s.fps)} FPS` : null);

/**
 * "Estatísticas da transmissão": o que cada conexão envia/recebe de vídeo, upload/download total
 * e o que limita a qualidade (CPU ou banda). Só amostra enquanto está aberto (getStats tem custo).
 */
@Component({
  selector: 'pq-stats-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2>Estatísticas da transmissão</h2>
      <button type="button" class="icon-btn" aria-label="Fechar estatísticas" (click)="closed.emit()"><pq-icon name="close" /></button>
    </header>
    <p class="summary">{{ summary() }}</p>
    <ul class="peers">
      @for (row of rows(); track row.id) {
        <li [attr.data-sending]="row.sending">
          <strong>{{ row.name }}</strong>
          <span>Envio: {{ row.out }}</span>
          <span>Recebimento: {{ row.in }}</span>
        </li>
      } @empty {
        <li class="empty">Ninguém mais no canal.</li>
      }
    </ul>
  `,
  styles: `
    :host { display: grid; gap: var(--pq-space-2); padding: var(--pq-space-3); border-radius: var(--pq-radius); background: var(--pq-surface); font-size: .8rem; }
    .head { display: flex; align-items: center; justify-content: space-between; }
    h2 { margin: 0; font-size: .95rem; }
    .icon-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--pq-text-muted); cursor: pointer; --pq-icon-size: 16px; }
    .summary { margin: 0; color: var(--pq-text-muted); }
    .peers { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--pq-space-2); font-family: var(--pq-font-mono); }
    li { display: grid; gap: 2px; padding: var(--pq-space-2); border-radius: var(--pq-radius-sm); background: var(--pq-surface-2); }
    li strong { font-family: var(--pq-font); }
    .empty { color: var(--pq-text-muted); }
  `,
})
export class StatsPanel {
  readonly closed = output<void>();

  private readonly voice = inject(VoiceRoomStore);
  protected readonly rows = signal<PeerRow[]>([]);
  protected readonly summary = signal('Medindo…');
  private previous = new Map<string, PeerStats>();

  constructor() {
    void this.tickAsync();
    const timer = window.setInterval(() => void this.tickAsync(), INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async tickAsync(): Promise<void> {
    const samples = await this.voice.collectStatsAsync();
    let up = 0;
    let down = 0;
    let sendingTo = 0;
    const rows = samples.map((s) => {
      const p = this.previous.get(s.id);
      const dt = p ? s.timestamp - p.timestamp : 0;
      up += p ? rate(s.bytesSent, p.bytesSent, dt) : 0;
      down += p ? rate(s.bytesReceived, p.bytesReceived, dt) : 0;
      // "Enviando" = quadros codificados nesta janela (não só bytes: RTCP também conta).
      const sending = !!(p?.out && s.out && s.out.frames > p.out.frames);
      const receiving = !!(p?.in && s.in && s.in.frames > p.in.frames);
      if (sending) sendingTo++;

      const out = !p ? 'medindo…' : !sending ? 'não está enviando' : [
        size(s.out), fps(s.out), mbps(rate(s.out!.bytes, p.out!.bytes, dt)),
        [s.out!.codec, s.out!.encoder && `(${s.out!.encoder})`].filter(Boolean).join(' '),
        s.out!.limitation && `limitado por: ${LIMITATION[s.out!.limitation] ?? s.out!.limitation}`,
      ].filter(Boolean).join(' · ');

      let inText = !p ? 'medindo…' : 'não está recebendo';
      if (receiving) {
        const frames = s.in!.frames - p.in!.frames;
        const decodeMs = frames > 0 ? ((s.in!.decodeTime - p.in!.decodeTime) * 1000) / frames : 0;
        inText = [
          size(s.in), fps(s.in), mbps(rate(s.in!.bytes, p.in!.bytes, dt)),
          [s.in!.codec, s.in!.decoder && `(${s.in!.decoder})`].filter(Boolean).join(' '),
          `decodificação ${decodeMs.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ms/quadro`,
          `perdidos ${s.in!.dropped}`,
        ].filter(Boolean).join(' · ');
      }

      return { id: s.id, name: this.voice.nameOfConnection(s.id) ?? s.id, out, in: inText, sending };
    });

    const measured = samples.some((s) => this.previous.has(s.id));
    const codec = this.voice.codec();
    this.summary.set((measured
      ? `Upload total ${mbps(up)} · Download total ${mbps(down)} · Vídeo indo para ${sendingTo} de ${samples.length}`
      : 'Medindo…') + (codec ? ` · Codec preferido: ${codec.reason}` : ''));
    this.rows.set(rows);
    this.previous = new Map(samples.map((s) => [s.id, s]));
  }
}
