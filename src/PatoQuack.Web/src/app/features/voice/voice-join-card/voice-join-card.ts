import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { Avatar, Button, Card, Label } from '../../../shared/ui';

/**
 * Cartão "entrar na voz" de um canal. O clique é o gesto que o navegador exige para liberar
 * microfone e áudio; o nome exibido é o da conta.
 */
@Component({
  selector: 'pq-voice-join-card',
  imports: [Avatar, Button, Card, Label],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-card>
      <div pqCardHeader class="channel-header">
        <h2 class="title"><span class="hash">#</span>{{ channelName() }}</h2>
        <pq-label tone="muted" size="sm">canal de voz</pq-label>
      </div>
      <div class="who">
        <pq-avatar [name]="userName()" size="sm" />
        <pq-label tone="muted" size="sm">Você entra como <strong>{{ userName() }}</strong></pq-label>
      </div>
      <button pqButton type="button" variant="primary" block [loading]="busy()" (click)="join.emit()">
        {{ busy() ? 'Entrando…' : 'Entrar na voz' }}
      </button>
    </pq-card>
  `,
  styles: `
    .channel-header { flex: 1; display: flex; justify-content: space-between; align-items: baseline; gap: var(--pq-space-2); }
    .title { margin: 0; font-size: 1.2rem; }
    .hash { color: var(--pq-text-muted); margin-right: 2px; }
    .who { display: flex; align-items: center; gap: var(--pq-space-2); }
  `,
})
export class VoiceJoinCard {
  readonly channelName = input.required<string>();
  readonly userName = input.required<string>();
  readonly busy = input(false, { transform: booleanAttribute });
  readonly join = output<void>();
}
