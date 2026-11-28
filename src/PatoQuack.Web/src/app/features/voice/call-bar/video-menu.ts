import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { listDevices } from '../../../core/media/devices';
import {
  StreamKind, UPLOAD_BUDGETS, VIDEO_FRAME_RATES, VideoQuality, budgetLabel, resolutionsFor, uploadEstimate,
} from '../../../core/media/quality';
import { Icon, MenuItem, MenuSeparator, Select, SelectOption, Switch } from '../../../shared/ui';
import { VoiceRoomStore } from '../data/voice-room.store';

/** Conteúdo do menu ˅ da câmera ou da tela: dispositivo, qualidade, upload máximo e prévia. */
@Component({
  selector: 'pq-video-menu',
  imports: [Icon, MenuItem, MenuSeparator, Select, Switch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kind() === 'screen' && voice.localVideoKind() === 'screen') {
      <button pqMenuItem danger (click)="voice.stopStreamAsync()"><pq-icon name="stop" />Parar de transmitir</button>
      <button pqMenuItem (click)="voice.changeScreenAsync()"><pq-icon name="swap" />Alterar a transmissão</button>
      <pq-menu-separator />
    }
    @if (kind() === 'camera') {
      <pq-select label="Câmera" [options]="cameras()" [value]="voice.currentCameraId()" emptyText="Nenhuma câmera encontrada"
                 (valueChange)="voice.selectCameraAsync($event)" />
      @if (!labeled()) {
        <p class="hint">Os nomes das câmeras aparecem depois que o navegador libera a câmera.</p>
      }
    }
    <div class="field">
      <span class="label">Qualidade {{ kind() === 'camera' ? 'da câmera' : 'da tela' }}</span>
      <div class="row">
        <pq-select ariaLabel="Resolução" [options]="resolutions()" [value]="quality().resolution"
                   (valueChange)="changeQuality({ resolution: $event, fps: quality().fps })" />
        <pq-select ariaLabel="Quadros por segundo" [options]="frameRates" [value]="quality().fps"
                   (valueChange)="changeQuality({ resolution: quality().resolution, fps: $event })" />
      </div>
      <span class="hint">{{ estimate() }}</span>
    </div>
    <pq-select label="Upload máximo" [options]="budgets" [value]="voice.uploadBudget()" (valueChange)="voice.setUploadBudgetAsync($event)" />
    <pq-switch [label]="kind() === 'camera' ? 'Sempre ver prévia do vídeo' : 'Sempre ver prévia da tela'"
               [checked]="voice.alwaysPreview()[kind()]" (checkedChange)="voice.setAlwaysPreview(kind(), $event)" />
  `,
  styles: `
    :host { display: grid; gap: var(--pq-space-3); }
    .field { display: grid; gap: 6px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--pq-space-2); }
    .label { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--pq-text-muted); }
    .hint { margin: 0; font-size: .75rem; color: var(--pq-text-muted); }
  `,
})
export class VideoMenu {
  readonly kind = input.required<StreamKind>();

  protected readonly voice = inject(VoiceRoomStore);
  protected readonly cameras = signal<SelectOption[]>([]);
  protected readonly labeled = signal(true);
  protected readonly frameRates: SelectOption<number>[] = VIDEO_FRAME_RATES.map((f) => ({ value: f, label: `${f} FPS` }));
  protected readonly budgets: SelectOption<number>[] = UPLOAD_BUDGETS.map((b) => ({ value: b, label: budgetLabel(b) }));

  protected readonly quality = computed(() => this.voice.quality()[this.kind()]);
  protected readonly resolutions = computed(() => resolutionsFor(this.kind()).map((r) => ({ value: r.id, label: r.label })));
  protected readonly estimate = computed(() => {
    const viewers = this.voice.localVideoKind() === this.kind() ? this.voice.viewerCount() : 0;
    return uploadEstimate(this.quality(), viewers, this.voice.uploadBudget());
  });

  constructor() {
    void listDevices('videoinput').then(({ options, labeled }) => {
      this.cameras.set(options.map((d) => ({ value: d.id, label: d.label })));
      this.labeled.set(labeled);
    });
  }

  protected changeQuality(q: VideoQuality): void {
    void this.voice.changeQualityAsync(this.kind(), q);
  }
}
