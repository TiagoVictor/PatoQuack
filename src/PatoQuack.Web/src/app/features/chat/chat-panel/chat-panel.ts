import {
  ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { Avatar, Icon } from '../../../shared/ui';
import { ChatItem, ChatStore, MAX_CHAT_LENGTH } from '../chat.store';
import { TextPart, linkify } from '../linkify';

const GROUP_GAP_MS = 7 * 60 * 1000; // mensagens da mesma pessoa até 7 min depois ficam agrupadas
const NEAR_BOTTOM_PX = 80;

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

interface Row {
  item: ChatItem;
  /** Separador de dia antes deste item. */
  day: string | null;
  /** Mesma pessoa, pouco depois da anterior: sem cabeçalho. */
  grouped: boolean;
  parts: TextPart[];
  time: string;
  title: string;
}

/**
 * Chat do canal: lista (histórico + ao vivo), envio, "digitando" e não lidas.
 * O texto das mensagens nunca vira HTML: só nós de texto e links http/https.
 */
@Component({
  selector: 'pq-chat-panel',
  imports: [Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel {
  readonly channelName = input('');
  readonly closed = output<void>();

  protected readonly chat = inject(ChatStore);
  protected readonly maxLength = MAX_CHAT_LENGTH;
  protected readonly draft = signal('');
  protected readonly newBelow = signal(false);

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>('input');
  private pinned = true;
  private lastCount = 0;
  private lastFirstKey: string | null = null;
  private heightBeforePrepend = 0;

  protected readonly rows = computed<Row[]>(() => {
    let prev: ChatItem | null = null;
    return this.chat.items().map((item) => {
      const newDay = !prev || prev.sentAt.toDateString() !== item.sentAt.toDateString();
      const grouped = !newDay && prev !== null && item.kind === 'message' && prev.kind === 'message'
        && prev.author === item.author && item.sentAt.getTime() - prev.sentAt.getTime() < GROUP_GAP_MS;
      prev = item;
      return {
        item,
        day: newDay ? dayFormat.format(item.sentAt) : null,
        grouped,
        parts: item.kind === 'message' ? linkify(item.text) : [],
        time: timeFormat.format(item.sentAt),
        title: `${dayFormat.format(item.sentAt)} ${timeFormat.format(item.sentAt)}`,
      };
    });
  });

  constructor() {
    this.chat.setOpen(true);
    // Depois de cada render: mantém o fim à vista (se estava no fim) ou a posição (ao carregar
    // mensagens antigas no topo); senão avisa "Novas mensagens".
    afterRenderEffect(() => {
      const rows = this.rows();
      const el = this.scroller().nativeElement;
      const firstKey = rows[0]?.item.key ?? null;
      const prepended = this.lastFirstKey !== null && firstKey !== this.lastFirstKey && rows.length > this.lastCount;
      if (prepended) {
        el.scrollTop += el.scrollHeight - this.heightBeforePrepend;
      } else if (rows.length > this.lastCount) {
        const last = rows[rows.length - 1]?.item;
        const mine = last?.kind === 'message' && last.mine;
        if (this.pinned || mine || this.lastCount === 0) {
          el.scrollTop = el.scrollHeight;
          this.newBelow.set(false);
          this.chat.markRead();
        } else {
          this.newBelow.set(true);
        }
      }
      this.lastCount = rows.length;
      this.lastFirstKey = firstKey;
      this.heightBeforePrepend = el.scrollHeight;
    });
  }

  ngOnDestroy(): void {
    this.chat.setOpen(false);
  }

  protected onScroll(): void {
    const el = this.scroller().nativeElement;
    this.pinned = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    this.heightBeforePrepend = el.scrollHeight;
    if (this.pinned) {
      this.newBelow.set(false);
      this.chat.markRead();
    }
  }

  protected scrollToBottom(): void {
    const el = this.scroller().nativeElement;
    el.scrollTop = el.scrollHeight;
    this.newBelow.set(false);
    this.chat.markRead();
  }

  protected loadOlder(): void {
    this.heightBeforePrepend = this.scroller().nativeElement.scrollHeight;
    void this.chat.loadOlderAsync();
  }

  protected onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    this.autosize();
    this.chat.clearError();
    if (el.value.trim()) this.chat.notifyTyping();
  }

  /** Enter envia; Shift+Enter quebra a linha. Durante composição (acentos/IME) não envia. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.sendAsync();
    }
  }

  protected async sendAsync(): Promise<void> {
    const text = this.draft();
    if (!text.trim()) return;
    this.setDraft('');
    const sent = await this.chat.sendAsync(text);
    // Não enviou (ex.: rápido demais): devolve o texto para não perder o que foi digitado.
    if (!sent && !this.draft()) this.setDraft(text);
  }

  private setDraft(value: string): void {
    this.draft.set(value);
    this.textarea().nativeElement.value = value;
    this.autosize();
  }

  private autosize(): void {
    const el = this.textarea().nativeElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }
}
