import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MediaStreamDirective } from '../../../shared/media/media-stream';
import { Avatar, Icon } from '../../../shared/ui';
import { PeerConnectionState, RoomParticipant, Streamer } from '../data/voice-room.models';
import { VideoQualityDirective } from '../video-quality/video-quality';

export const STREAM_KEY = 'stream';

const CONNECTION_LABELS: Partial<Record<PeerConnectionState, string>> = {
  waiting: 'aguardando',
  new: 'conectando',
  connecting: 'conectando',
  disconnected: 'instável',
  failed: 'falhou',
};

/**
 * Palco da chamada: blocos 16:9 da transmissão e de cada participante.
 * - grade: todos na área principal;
 * - ampliado (`focus`): um bloco grande e os outros em miniatura no topo;
 * - `compact`: só a faixa de miniaturas (o chat ocupa o palco).
 * Clicar num bloco amplia/volta para a grade; na transmissão que ainda não assistimos, começa a assistir.
 */
@Component({
  selector: 'pq-stage',
  imports: [NgTemplateOutlet, Avatar, Icon, MediaStreamDirective, VideoQualityDirective],
  host: { '[class.compact]': 'compact()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stage.html',
  styleUrl: './stage.css',
})
export class Stage {
  readonly participants = input.required<readonly RoomParticipant[]>();
  readonly streamer = input<Streamer | null>(null);
  readonly streamerParticipantId = input<string | null>(null);
  readonly streamSource = input<MediaStream | null>(null);
  readonly isLocalStreamer = input(false);
  readonly watching = input(false);
  readonly showNonVideo = input(true);
  readonly focus = input<string | null>(null);
  readonly compact = input(false);
  readonly narrow = input(false);

  readonly tileClick = output<string>();
  readonly quality = output<string>();

  protected readonly streamKey = STREAM_KEY;

  protected readonly keys = computed(() => {
    const keys = this.streamer() ? [STREAM_KEY] : [];
    return this.showNonVideo() ? keys.concat(this.participants().map((p) => p.id)) : keys;
  });

  /** Bloco ampliado válido (pode ter saído da chamada). */
  protected readonly focused = computed(() => {
    const focus = this.focus();
    return focus && this.keys().includes(focus) ? focus : null;
  });

  protected readonly mainKeys = computed(() => {
    if (this.compact()) return [];
    const focused = this.focused();
    return focused ? [focused] : this.keys();
  });

  protected readonly stripKeys = computed(() => {
    if (this.compact()) return this.keys();
    const focused = this.focused();
    return focused ? this.keys().filter((k) => k !== focused) : [];
  });

  /** Colunas × linhas da grade para n blocos. */
  protected readonly shape = computed(() => {
    const n = this.mainKeys().length;
    if (n <= 1) return [1, 1];
    if (this.narrow()) return [2, Math.ceil(n / 2)];
    if (n === 2) return [2, 1];
    if (n <= 4) return [2, 2];
    if (n <= 6) return [3, 2];
    return [3, Math.ceil(n / 3)];
  });

  protected readonly streamIdle = computed(() => !this.isLocalStreamer() && !this.watching());

  protected participant(key: string): RoomParticipant | undefined {
    return this.participants().find((p) => p.id === key);
  }

  protected connectionLabel(p: RoomParticipant): string | null {
    return p.isLocal ? null : CONNECTION_LABELS[p.connection] ?? null;
  }

  protected hue(name: string): number {
    let hash = 0;
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return hash % 360;
  }

  protected tileLabel(key: string): string {
    if (key === STREAM_KEY) {
      const streamer = this.streamer();
      if (this.isLocalStreamer()) return 'Sua transmissão, ao vivo';
      return this.streamIdle() ? `Transmissão de ${streamer?.name}, ao vivo. Clique para assistir` : `Transmissão de ${streamer?.name}, ao vivo`;
    }
    const p = this.participant(key);
    if (!p) return '';
    const parts = [p.isLocal ? `${p.name} (você)` : p.name];
    if (p.muted) parts.push('mutado');
    const conn = this.connectionLabel(p);
    if (conn) parts.push(conn);
    return parts.join(', ');
  }
}
