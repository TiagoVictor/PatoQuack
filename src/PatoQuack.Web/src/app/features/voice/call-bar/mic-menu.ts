import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DeviceOption, listDevices } from '../../../core/media/devices';
import { LevelMeter, MenuSeparator, Range, Select, SelectOption, Switch } from '../../../shared/ui';
import { VoiceRoomStore } from '../data/voice-room.store';

/** Conteúdo do menu ˅ do microfone. Criado ao abrir o menu (e destruído ao fechar). */
@Component({
  selector: 'pq-mic-menu',
  imports: [LevelMeter, MenuSeparator, Range, Select, Switch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-select label="Dispositivo de entrada" [options]="mics()" [value]="micId()" emptyText="Nenhum microfone encontrado"
               (valueChange)="selectMic($event)" />
    @if (voice.canPickSpeaker) {
      <pq-select label="Dispositivo de saída" [options]="speakers()" [value]="voice.speakerId() ?? 'default'"
                 emptyText="Nenhuma saída encontrada" (valueChange)="voice.selectSpeaker($event)" />
    } @else {
      <p class="hint">Este navegador não deixa a página escolher a saída de áudio; o som sai pelo dispositivo padrão.</p>
    }
    <pq-menu-separator />
    <div class="field">
      <span class="label">Nível de entrada</span>
      <pq-level-meter [level]="level()" label="Nível do microfone" />
    </div>
    <pq-range label="Volume de saída" [value]="volumePercent()" suffix="%" (valueChange)="voice.setOutputVolume($event / 100)" />
    <p class="hint">No iPhone/iPad o volume é controlado só pelos botões do aparelho.</p>
    <pq-menu-separator />
    <pq-switch label="Desativar áudio" description="Não ouve ninguém e muta seu microfone"
               [checked]="voice.deafened()" (checkedChange)="voice.setDeafenedAsync($event)" />
  `,
  styles: `
    :host { display: grid; gap: var(--pq-space-3); }
    .field { display: grid; gap: 6px; }
    .label { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--pq-text-muted); }
    .hint { margin: 0; font-size: .75rem; color: var(--pq-text-muted); }
  `,
})
export class MicMenu {
  protected readonly voice = inject(VoiceRoomStore);
  protected readonly mics = signal<SelectOption[]>([]);
  protected readonly speakers = signal<SelectOption[]>([]);
  protected readonly micId = signal<string | null>(this.voice.currentMicId());
  protected readonly level = signal(0);
  protected readonly volumePercent = () => Math.round(this.voice.outputVolume() * 100);

  constructor() {
    void this.loadDevicesAsync();
    const meter = this.voice.createMicAnalyser();
    let raf = 0;
    if (meter) {
      const buffer = new Float32Array(meter.analyser.fftSize);
      const tick = () => {
        meter.analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const s of buffer) sum += s * s;
        const rms = Math.sqrt(sum / buffer.length);
        // Escala em dB (-60 dB = vazio, 0 dB = cheio), como os medidores de áudio costumam mostrar.
        this.level.set(rms > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60)) : 0);
        raf = requestAnimationFrame(tick);
      };
      tick();
    }
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(raf);
      meter?.dispose();
    });
  }

  protected async selectMic(deviceId: string): Promise<void> {
    this.micId.set(deviceId);
    await this.voice.selectMicAsync(deviceId);
  }

  private async loadDevicesAsync(): Promise<void> {
    const toOptions = (list: DeviceOption[]) => list.map((d) => ({ value: d.id, label: d.label }));
    this.mics.set(toOptions((await listDevices('audioinput')).options));
    if (this.voice.canPickSpeaker) this.speakers.set(toOptions((await listDevices('audiooutput')).options));
  }
}
