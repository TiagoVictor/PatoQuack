import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output, signal } from '@angular/core';
import { StreamKind } from '../../../core/media/quality';
import { Icon, Menu, MenuSeparator, Switch } from '../../../shared/ui';
import { ChatStore } from '../../chat/chat.store';
import { VoiceRoomStore } from '../data/voice-room.store';
import { MicMenu } from './mic-menu';
import { VideoMenu } from './video-menu';

/** Opções de exibição que moram na tela da chamada (o menu ⋯ só as mostra e devolve as mudanças). */
export interface StageOptions {
  grid: boolean;
  showNonVideo: boolean;
  stats: boolean;
}

/**
 * Barra de controles da chamada: microfone, câmera e tela (botão + menu ˅), chat, mais opções e
 * desligar. Os botões refletem o estado do VoiceRoomStore; as opções de exibição vêm da tela.
 */
@Component({
  selector: 'pq-call-bar',
  imports: [Icon, Menu, MenuSeparator, MicMenu, Switch, VideoMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-bar.html',
  styleUrl: './call-bar.css',
})
export class CallBar {
  readonly options = input.required<StageOptions>();
  readonly chatOpen = input(false, { transform: booleanAttribute });
  readonly optionsChange = output<Partial<StageOptions>>();
  readonly toggleChat = output<void>();

  protected readonly voice = inject(VoiceRoomStore);
  protected readonly chat = inject(ChatStore);

  protected readonly micMenu = signal(false);
  protected readonly cameraMenu = signal(false);
  protected readonly screenMenu = signal(false);
  protected readonly moreMenu = signal(false);

  protected readonly micLabel = computed(() => this.voice.muted() ? 'Desmutar' : 'Mutar');

  protected streamTitle(kind: StreamKind): string {
    const label = kind === 'camera' ? 'câmera' : 'tela';
    const mine = this.voice.localVideoKind() === kind;
    const blockedBy = this.voice.streamBlockedBy();
    if (mine) return `Parar de transmitir a ${label}`;
    if (blockedBy) return `${blockedBy.name} já está transmitindo`;
    if (this.voice.localVideoKind()) return 'Pare a transmissão atual primeiro';
    return `Transmitir ${label}`;
  }

  protected streamDisabled(kind: StreamKind): boolean {
    const mine = this.voice.localVideoKind() === kind;
    return this.voice.startingStream() || (!mine && (!!this.voice.localVideoKind() || !!this.voice.streamBlockedBy()));
  }
}
