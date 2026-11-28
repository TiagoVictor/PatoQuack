import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../../core/auth/auth.store';
import { Card, Label, StatusMessage } from '../../../shared/ui';
import { ActivityLog } from '../../voice/activity-log/activity-log';
import { VoiceRoomStore } from '../../voice/data/voice-room.store';
import { VoiceJoinCard } from '../../voice/voice-join-card/voice-join-card';
import { VoiceRoom } from '../../voice/voice-room/voice-room';
import { ServerStore } from '../data/server.store';

/**
 * Canal aberto (rota /s/:serverId/c/:channelId). Antes de entrar mostra o cartão de entrada;
 * dentro, a sala de voz. Trocar de canal na lista com a voz ligada troca direto, sem novo clique.
 */
@Component({
  selector: 'pq-channel-page',
  imports: [ActivityLog, Card, Label, StatusMessage, VoiceJoinCard, VoiceRoom],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (channel(); as channel) {
      @if (inThisChannel()) {
        <pq-voice-room />
      } @else {
        <pq-voice-join-card [channelName]="channel.name" [userName]="auth.user()?.name ?? ''"
                            [busy]="voice.phase() === 'joining'" (join)="join()" />
      }
    } @else if (!server.loading()) {
      <pq-card><pq-label tone="danger">Canal não encontrado neste servidor.</pq-label></pq-card>
    }

    <pq-status-message [level]="voice.status()?.level ?? 'info'">{{ voice.status()?.message }}</pq-status-message>
    <pq-activity-log [entries]="voice.log()" />
  `,
  styles: `:host { display: grid; gap: var(--pq-space-4); }`,
})
export class ChannelPage {
  /** Parâmetro :channelId da rota. */
  readonly channelId = input.required<string>();

  protected readonly server = inject(ServerStore);
  protected readonly voice = inject(VoiceRoomStore);
  protected readonly auth = inject(AuthStore);

  protected readonly channel = computed(() => this.server.channelById(this.channelId()));
  protected readonly inThisChannel = computed(() =>
    this.voice.inRoom() && this.voice.channel()?.id === this.channelId());

  constructor() {
    // Mesmo componente, outro :channelId: se a voz está ligada, troca de canal.
    effect(() => {
      const channel = this.channel();
      if (channel && this.voice.inRoom() && this.voice.channel()?.id !== channel.id) {
        void this.voice.switchChannelAsync({ id: channel.id, name: channel.name });
      }
    });

    // O dono excluiu um canal (avisado pelo hub): some da lista.
    effect(() => {
      const deleted = this.voice.deletedChannelId();
      if (deleted) this.server.removeChannel(deleted);
    });

    // O servidor nos tirou da chamada (ex.: saímos do servidor em outra aba): volta ao início.
    const router = inject(Router);
    const startedAt = Date.now();
    effect(() => {
      const kicked = this.voice.kicked();
      if (kicked && kicked.at >= startedAt) void router.navigate(['/']);
    });

    // Sair da tela do canal (voltar ao início, outro servidor) desliga a voz.
    inject(DestroyRef).onDestroy(() => {
      if (this.voice.inRoom()) void this.voice.leaveAsync();
    });
  }

  protected join(): void {
    const channel = this.channel();
    if (channel) void this.voice.joinAsync({ id: channel.id, name: channel.name });
  }
}
