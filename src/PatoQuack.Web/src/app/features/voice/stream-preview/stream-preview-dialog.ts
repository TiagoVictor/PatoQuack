import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { listDevices } from '../../../core/media/devices';
import {
  UPLOAD_BUDGETS, VIDEO_FRAME_RATES, VideoQuality, budgetLabel, constraintsFor, resolutionsFor, uploadEstimate,
} from '../../../core/media/quality';
import { MediaStreamDirective } from '../../../shared/media/media-stream';
import { Button, Dialog, Icon, Label, Select, SelectOption, Switch } from '../../../shared/ui';
import { VoiceRoomStore } from '../data/voice-room.store';

/**
 * Prévia antes de transmitir: mostra o vídeo capturado e deixa trocar câmera/tela, qualidade e
 * upload máximo. Nada vai para a sala enquanto está aberta; fechar cancela e encerra a captura.
 */
@Component({
  selector: 'pq-stream-preview-dialog',
  imports: [Button, Dialog, Icon, Label, MediaStreamDirective, Select, Switch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-dialog [open]="!!request()" [heading]="heading()" (closed)="voice.cancelPreview()">
      @if (request(); as req) {
        <div class="video">
          <video [pqMediaStream]="req.media" autoplay playsinline muted aria-label="Prévia do vídeo"></video>
        </div>
        @if (req.kind === 'camera') {
          <pq-select label="Câmera" [options]="cameras()" [value]="voice.currentCameraId()" (valueChange)="selectCameraAsync($event)" />
        } @else {
          <button pqButton type="button" size="sm" (click)="voice.recapturePreviewAsync()">
            <pq-icon name="swap" />Escolher outra tela ou janela
          </button>
        }
        <div class="row">
          <pq-select label="Resolução" [options]="resolutions()" [value]="quality().resolution"
                     (valueChange)="changeQualityAsync({ resolution: $event, fps: quality().fps })" />
          <pq-select label="Quadros por segundo" [options]="frameRates" [value]="quality().fps"
                     (valueChange)="changeQualityAsync({ resolution: quality().resolution, fps: $event })" />
        </div>
        <pq-select label="Upload máximo (dividido entre quem assistir)" [options]="budgets" [value]="voice.uploadBudget()"
                   (valueChange)="voice.setUploadBudgetAsync($event)" />
        <pq-label tone="muted" size="sm">{{ estimate() }}</pq-label>
        @if (voice.streamBlockedBy(); as blocked) {
          <pq-label tone="warning" size="sm" role="alert">{{ blocked.name }} começou a transmitir. Só uma transmissão por vez no canal.</pq-label>
        }
        <pq-switch [label]="req.kind === 'camera' ? 'Sempre ver prévia do vídeo' : 'Sempre ver prévia da tela'"
                   [checked]="voice.alwaysPreview()[req.kind]" (checkedChange)="voice.setAlwaysPreview(req.kind, $event)" />
      }
      <div pqDialogActions>
        <button pqButton type="button" (click)="voice.cancelPreview()">Cancelar</button>
        <button pqButton type="button" variant="primary" [disabled]="!!voice.streamBlockedBy()" (click)="confirm()">
          {{ request()?.kind === 'camera' ? 'Ativar câmera' : 'Transmitir tela' }}
        </button>
      </div>
    </pq-dialog>
  `,
  styles: `
    .video { aspect-ratio: 16 / 9; background: #000; border-radius: var(--pq-radius-sm); overflow: hidden; }
    video { width: 100%; height: 100%; object-fit: contain; display: block; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--pq-space-2); }
  `,
})
export class StreamPreviewDialog {
  protected readonly voice = inject(VoiceRoomStore);
  protected readonly request = this.voice.preview;
  protected readonly cameras = signal<SelectOption[]>([]);
  protected readonly frameRates: SelectOption<number>[] = VIDEO_FRAME_RATES.map((f) => ({ value: f, label: `${f} FPS` }));
  protected readonly budgets: SelectOption<number>[] = UPLOAD_BUDGETS.map((b) => ({ value: b, label: budgetLabel(b) }));

  protected readonly heading = computed(() => this.request()?.kind === 'screen' ? 'Transmitir a tela?' : 'Vamos ligar a câmera?');
  protected readonly quality = computed(() => this.voice.quality()[this.request()?.kind ?? 'camera']);
  protected readonly resolutions = computed(() =>
    resolutionsFor(this.request()?.kind ?? 'camera').map((r) => ({ value: r.id, label: r.label })));
  // Ninguém assiste antes de começar: a estimativa é por pessoa que assistir.
  protected readonly estimate = computed(() => uploadEstimate(this.quality(), 0, this.voice.uploadBudget()));

  constructor() {
    // Com permissão de câmera, os nomes já aparecem.
    effect(() => {
      if (this.request()?.kind === 'camera') {
        void listDevices('videoinput').then(({ options }) => this.cameras.set(options.map((d) => ({ value: d.id, label: d.label }))));
      }
    });
  }

  protected confirm(): void {
    const req = this.request();
    if (req) this.voice.confirmPreview(req.media);
  }

  protected async selectCameraAsync(deviceId: string): Promise<void> {
    await this.voice.selectCameraAsync(deviceId);
    await this.voice.recapturePreviewAsync();
  }

  /** Nova qualidade: aplica na captura da prévia (sem abrir o seletor de novo). */
  protected async changeQualityAsync(q: VideoQuality): Promise<void> {
    const req = this.request();
    if (!req) return;
    this.voice.setQualityPref(req.kind, q);
    try {
      await req.media.getVideoTracks()[0]?.applyConstraints(constraintsFor(req.kind, this.voice.quality()[req.kind]));
    } catch {
      if (req.kind === 'camera') await this.voice.recapturePreviewAsync();
    }
  }
}
