import { Directive, ElementRef, OnDestroy, inject, output } from '@angular/core';

/** Menor janela para calcular o FPS exibido (abaixo disso, poucos quadros distorcem a conta). */
const MIN_FPS_WINDOW_MS = 500;

/**
 * Mede o vídeo que ESTE navegador exibe (resolução e FPS) e emite um rótulo como "1080p 30FPS"
 * a cada segundo. Para quem assiste, é o que chega pela rede; para quem transmite, a captura.
 * Sem requestVideoFrameCallback, mostra só a resolução.
 */
@Directive({ selector: 'video[pqVideoQuality]' })
export class VideoQualityDirective implements OnDestroy {
  readonly pqVideoQuality = output<string>();

  private readonly video = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;
  private frames = 0;
  private since = performance.now();
  private readonly countsFrames = 'requestVideoFrameCallback' in this.video;
  private readonly timer: number;
  private readonly restart = () => { this.frames = 0; this.since = performance.now(); };

  constructor() {
    if (this.countsFrames) {
      const onFrame = () => {
        this.frames++;
        if (this.video.isConnected) this.video.requestVideoFrameCallback(onFrame);
      };
      this.video.requestVideoFrameCallback(onFrame);
    }
    // Ao voltar para a aba, recomeça a contagem (o tempo escondido não entra na média).
    document.addEventListener('visibilitychange', this.restart);
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.restart);
  }

  private tick(): void {
    const now = performance.now();
    // Aba escondida não desenha quadros: medir agora daria "0FPS" falso.
    if (document.hidden) { this.restart(); return; }
    if (now - this.since < MIN_FPS_WINDOW_MS) return;
    const fps = Math.round((this.frames * 1000) / (now - this.since));
    this.restart();
    const res = this.video.videoHeight ? `${this.video.videoHeight}p` : '';
    this.pqVideoQuality.emit(res && this.countsFrames ? `${res} ${fps}FPS` : res);
  }
}
