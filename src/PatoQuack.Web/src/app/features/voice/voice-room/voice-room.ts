import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal,
} from '@angular/core';
import { readBool, writePref } from '../../../core/media/preferences';
import { errorMessage } from '../../../core/util/error-message';
import { MediaStreamDirective } from '../../../shared/media/media-stream';
import { Avatar, Icon } from '../../../shared/ui';
import { ChatPanel } from '../../chat/chat-panel/chat-panel';
import { ChatStore } from '../../chat/chat.store';
import { CallBar, StageOptions } from '../call-bar/call-bar';
import { LOCAL_ID, VoiceRoomStore } from '../data/voice-room.store';
import { STREAM_KEY, Stage } from '../stage/stage';
import { StatsPanel } from '../stats-panel/stats-panel';
import { StreamPreviewDialog } from '../stream-preview/stream-preview-dialog';

/**
 * Tela da chamada: cabeçalho (canal, quem transmite, qualidade), palco (grade/ampliado), chat no
 * palco, estatísticas e barra de controles. O estado da voz fica no VoiceRoomStore; aqui só a
 * disposição da tela (bloco ampliado, chat aberto, opções de exibição).
 */
@Component({
  selector: 'pq-voice-room',
  imports: [Avatar, CallBar, ChatPanel, Icon, MediaStreamDirective, Stage, StatsPanel, StreamPreviewDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './voice-room.html',
  styleUrl: './voice-room.css',
})
export class VoiceRoom {
  protected readonly store = inject(VoiceRoomStore);
  protected readonly chat = inject(ChatStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly focus = signal<string | null>(null);
  protected readonly chatOpen = signal(false);
  protected readonly showNonVideo = signal(readBool('pq.showNonVideo', true));
  protected readonly statsOpen = signal(false);
  protected readonly qualityLabel = signal('');
  protected readonly fullscreen = signal(false);
  protected readonly narrow = signal(false);
  protected readonly now = signal(Date.now());

  protected readonly canPip = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;
  protected readonly canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  protected readonly options = computed<StageOptions>(() => ({
    grid: this.focus() === null,
    showNonVideo: this.showNonVideo(),
    stats: this.statsOpen(),
  }));

  protected readonly remoteAudio = computed(() => this.store.participants().filter((p) => p.audio));

  protected readonly streamTitle = computed(() => {
    const streamer = this.store.streamer();
    if (!streamer) return null;
    const kind = this.store.localVideoKind();
    return this.store.isLocalStreamer() && kind
      ? kind === 'camera' ? 'Sua câmera' : 'Sua tela'
      : `Transmissão de ${streamer.name}`;
  });

  protected readonly viewersText = computed(() => {
    const n = this.store.viewerCount();
    return n === 0 ? 'Ninguém assistindo ainda' : n === 1 ? '1 pessoa assistindo' : `${n} pessoas assistindo`;
  });

  protected readonly elapsed = computed(() => {
    const since = this.store.joinedAt();
    if (!since) return '';
    const total = Math.max(0, Math.floor((this.now() - since) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  });

  constructor() {
    const timer = window.setInterval(() => this.now.set(Date.now()), 1000);
    const media = window.matchMedia('(max-width: 720px)');
    const onMedia = () => this.narrow.set(media.matches);
    const onFullscreen = () => this.fullscreen.set(document.fullscreenElement === this.host);
    onMedia();
    media.addEventListener('change', onMedia);
    document.addEventListener('fullscreenchange', onFullscreen);

    // A transmissão acabou: volta para a grade.
    effect(() => {
      if (!this.store.streamer() && this.focus() === STREAM_KEY) this.focus.set(null);
    });

    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      media.removeEventListener('change', onMedia);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement === this.host) void document.exitFullscreen().catch(() => {});
    });
  }

  /**
   * Clique num bloco: na transmissão que ainda não assistimos, começa a assistir (e amplia);
   * com o chat aberto, amplia o bloco e recolhe o chat; senão alterna ampliado/grade.
   */
  protected onTileClick(key: string): void {
    if (key === STREAM_KEY && !this.store.isLocalStreamer() && !this.store.watching()) {
      void this.store.setWatchingAsync(true);
      this.chatOpen.set(false);
      this.focus.set(STREAM_KEY);
      return;
    }
    if (this.chatOpen()) {
      this.chatOpen.set(false);
      this.focus.set(key);
      return;
    }
    this.focus.set(this.focus() === key ? null : key);
  }

  protected onOptionsChange(change: Partial<StageOptions>): void {
    if (change.showNonVideo !== undefined) {
      this.showNonVideo.set(change.showNonVideo);
      writePref('pq.showNonVideo', change.showNonVideo);
    }
    if (change.stats !== undefined) this.statsOpen.set(change.stats);
    if (change.grid !== undefined) {
      this.chatOpen.set(false);
      // Sem grade = um bloco em destaque: a transmissão, se houver; senão outra pessoa.
      const others = this.store.participants().filter((p) => p.id !== LOCAL_ID);
      this.focus.set(change.grid ? null : this.store.streamer() ? STREAM_KEY : others[0]?.id ?? LOCAL_ID);
    }
  }

  protected toggleChat(): void {
    this.chatOpen.update((open) => !open);
  }

  protected async stopWatchingAsync(): Promise<void> {
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => {});
    if (this.focus() === STREAM_KEY) this.focus.set(null);
    await this.store.setWatchingAsync(false);
  }

  protected async togglePipAsync(): Promise<void> {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      const video = this.host.querySelector<HTMLVideoElement>('video.stream-video');
      if (video?.srcObject) await video.requestPictureInPicture();
    } catch (error) {
      this.store.setStatus(`Não foi possível abrir a janela flutuante: ${errorMessage(error)}`, 'warn');
    }
  }

  protected async toggleFullscreenAsync(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.host.requestFullscreen();
    } catch (error) {
      this.store.setStatus(`Não foi possível usar a tela cheia: ${errorMessage(error)}`, 'warn');
    }
  }
}
