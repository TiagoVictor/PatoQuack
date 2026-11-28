import { Directive, ElementRef, effect, inject, input, output } from '@angular/core';

/**
 * Liga um MediaStream a um <audio>/<video> (srcObject não é atributo, então não dá para usar
 * binding comum) e tenta tocar. Não reinicia o elemento se o stream novo tiver os mesmos tracks.
 *
 *   <video [pqMediaStream]="stream()" autoplay playsinline muted></video>
 */
@Directive({ selector: 'audio[pqMediaStream], video[pqMediaStream]' })
export class MediaStreamDirective {
  readonly pqMediaStream = input<MediaStream | null | undefined>();
  /** Volume (0..1) — áudio dos participantes. */
  readonly volume = input<number | null>(null);
  /** Silencia o elemento (ex.: "desativar áudio"). */
  readonly silenced = input(false);
  /** Saída de áudio (deviceId) quando o navegador permite escolher. */
  readonly sinkId = input<string | null>(null);
  /** O navegador bloqueou a reprodução (autoplay sem gesto do usuário). */
  readonly playBlocked = output<void>();
  /** A saída de áudio escolhida não está disponível. */
  readonly sinkFailed = output<void>();

  private readonly element = inject<ElementRef<HTMLMediaElement>>(ElementRef).nativeElement;

  constructor() {
    effect(() => {
      const stream = this.pqMediaStream() ?? null;
      const current = this.element.srcObject as MediaStream | null;
      if (sameTracks(current, stream)) return;

      this.element.srcObject = stream;
      if (stream) {
        this.element.play().catch(() => this.playBlocked.emit());
      }
    });

    effect(() => {
      const volume = this.volume();
      if (volume !== null) this.element.volume = Math.min(1, Math.max(0, volume));
    });

    effect(() => {
      this.element.muted = this.silenced() || this.element.hasAttribute('muted');
    });

    effect(() => {
      const sinkId = this.sinkId();
      const element = this.element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (element.setSinkId) element.setSinkId(sinkId ?? '').catch(() => this.sinkFailed.emit());
    });
  }
}

function sameTracks(a: MediaStream | null, b: MediaStream | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const tracksA = a.getTracks();
  const tracksB = b.getTracks();
  return tracksA.length === tracksB.length && tracksA.every((t, i) => t === tracksB[i]);
}
