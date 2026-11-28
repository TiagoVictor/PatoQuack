import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { readBool, writePref } from '../../core/media/preferences';
import { ChatMessageDto } from '../../core/signaling/voice.models';
import { VoiceSignalingService } from '../../core/signaling/voice-signaling.service';
import { errorMessage } from '../../core/util/error-message';
import { VoiceRoomStore } from '../voice/data/voice-room.store';

export const MAX_CHAT_LENGTH = 2000;
const TYPING_SEND_MS = 3000; // avisa "digitando" no máximo a cada 3 s
const TYPING_SHOW_MS = 5000; // some 5 s depois do último aviso

/** Item da lista: mensagem guardada ou linha de sistema ("Ana entrou", gerada aqui, não guardada). */
export type ChatItem =
  | { kind: 'message'; key: string; id: number; author: string; text: string; sentAt: Date; mine: boolean }
  | { kind: 'system'; key: string; text: string; sentAt: Date };

/**
 * Chat de texto do canal atual: histórico paginado, mensagens ao vivo, "digitando", não lidas e
 * linhas de sistema. Acompanha a voz: entrou num canal, carrega o histórico dele; saiu, limpa.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly voice = inject(VoiceRoomStore);
  private readonly signaling = inject(VoiceSignalingService);

  private readonly _items = signal<readonly ChatItem[]>([]);
  private readonly _hasMore = signal(false);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _typing = signal<ReadonlyMap<string, number>>(new Map());
  private readonly _unread = signal(0);
  private readonly _open = signal(false);
  private readonly _sound = signal(readBool('pq.chatSound', true));
  private seen = new Set<number>();
  private systemSeq = 0;
  private lastTypingSent = 0;
  /** Muda a cada carga de canal: respostas atrasadas do canal anterior são ignoradas. */
  private generation = 0;

  readonly items = this._items.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly unread = this._unread.asReadonly();
  readonly open = this._open.asReadonly();
  readonly sound = this._sound.asReadonly();
  /** "Ana está digitando…" (ou vazio). */
  readonly typingText = computed(() => {
    const names = [...this._typing().keys()].map((id) => this.voice.nameOfConnection(id)).filter((n): n is string => !!n);
    return names.length === 0 ? ''
      : names.length === 1 ? `${names[0]} está digitando…`
      : names.length === 2 ? `${names[0]} e ${names[1]} estão digitando…`
      : 'Várias pessoas estão digitando…';
  });

  constructor() {
    // Entrou num canal (ou trocou): recomeça com o histórico dele. Saiu: limpa.
    effect(() => {
      const channelId = this.voice.inRoom() ? this.voice.channel()?.id : null;
      untracked(() => {
        this.reset();
        if (channelId) void this.loadOlderAsync();
      });
    });

    const subscription = this.voice.events.subscribe((event) => {
      switch (event.type) {
        case 'chat': this.add(event.message); break;
        case 'typing': this.onTyping(event.id); break;
        case 'joined': this.system(`${event.name} entrou no canal`); break;
        case 'left': this.system(`${event.name} saiu do canal`); this.clearTyping(event.id); break;
        case 'stream-started': if (!event.self) this.system(`${event.name} começou a transmitir`); break;
        case 'stream-stopped': if (!event.self) this.system(`${event.name} parou de transmitir`); break;
      }
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.markRead(); });
  }

  setOpen(open: boolean): void {
    this._open.set(open);
    if (open) this.markRead();
  }

  setSound(on: boolean): void {
    this._sound.set(on);
    writePref('pq.chatSound', on);
  }

  /** A pessoa está vendo o fim da lista: zera as não lidas. */
  markRead(): void {
    if (this._open() && !document.hidden) this._unread.set(0);
  }

  async sendAsync(text: string): Promise<boolean> {
    const value = text.trim();
    if (!value) return false;
    if (value.length > MAX_CHAT_LENGTH) {
      this._error.set(`A mensagem passou de ${MAX_CHAT_LENGTH} caracteres.`);
      return false;
    }
    this.lastTypingSent = 0;
    try {
      this.add(await this.signaling.sendChatMessageAsync(value));
      this._error.set(null);
      return true;
    } catch (error) {
      this._error.set(errorMessage(error));
      return false;
    }
  }

  /** Avisa que está digitando (no máximo a cada 3 s). */
  notifyTyping(): void {
    const now = Date.now();
    if (now - this.lastTypingSent < TYPING_SEND_MS) return;
    this.lastTypingSent = now;
    this.signaling.typingAsync().catch(() => {});
  }

  clearError(): void {
    this._error.set(null);
  }

  /** Busca a página anterior do histórico e põe no topo. */
  async loadOlderAsync(): Promise<void> {
    if (this._loading()) return;
    const generation = this.generation;
    const oldest = this._items().find((i) => i.kind === 'message');
    this._loading.set(true);
    try {
      const page = await this.signaling.getChatHistoryAsync(oldest?.kind === 'message' ? oldest.id : null);
      if (generation !== this.generation) return;
      const fresh = page.messages.filter((m) => !this.seen.has(m.id));
      fresh.forEach((m) => this.seen.add(m.id));
      this._items.update((items) => [...fresh.map((m) => this.toItem(m)), ...items]);
      this._hasMore.set(page.hasMore);
    } catch (error) {
      if (generation === this.generation) this._error.set(`Não foi possível carregar o histórico: ${errorMessage(error)}`);
    } finally {
      if (generation === this.generation) this._loading.set(false);
    }
  }

  private reset(): void {
    this.generation++;
    this.seen = new Set();
    this._items.set([]);
    this._hasMore.set(false);
    this._loading.set(false);
    this._error.set(null);
    this._unread.set(0);
    for (const timer of this._typing().values()) clearTimeout(timer);
    this._typing.set(new Map());
  }

  private add(message: ChatMessageDto): void {
    if (this.seen.has(message.id)) return;
    this.seen.add(message.id);
    const item = this.toItem(message);
    this._items.update((items) => [...items, item]);
    if (message.authorConnectionId) this.clearTyping(message.authorConnectionId);
    if (item.kind === 'message' && !item.mine) {
      const unseen = !this._open() || document.hidden;
      if (unseen) {
        this._unread.update((n) => n + 1);
        if (this._sound()) playMessageSound();
      }
    }
  }

  private system(text: string): void {
    if (!this.voice.inRoom()) return;
    this._items.update((items) => [...items, { kind: 'system', key: `s${++this.systemSeq}`, text, sentAt: new Date() }]);
  }

  private toItem(message: ChatMessageDto): ChatItem {
    return {
      kind: 'message',
      key: `m${message.id}`,
      id: message.id,
      author: message.authorName,
      text: message.text,
      sentAt: new Date(message.sentAt),
      mine: message.authorConnectionId !== null && message.authorConnectionId === this.signaling.connectionId,
    };
  }

  private onTyping(connectionId: string): void {
    const timers = new Map(this._typing());
    clearTimeout(timers.get(connectionId));
    timers.set(connectionId, window.setTimeout(() => this.clearTyping(connectionId), TYPING_SHOW_MS));
    this._typing.set(timers);
  }

  private clearTyping(connectionId: string): void {
    const timers = this._typing();
    if (!timers.has(connectionId)) return;
    clearTimeout(timers.get(connectionId));
    const next = new Map(timers);
    next.delete(connectionId);
    this._typing.set(next);
  }
}

/** Bipe curto para mensagem fora da vista (sem arquivo de áudio). */
function playMessageSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => void ctx.close();
  } catch { /* sem áudio */ }
}
