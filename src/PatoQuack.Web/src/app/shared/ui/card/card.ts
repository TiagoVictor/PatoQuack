import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Superfície com padding. Conteúdo com o atributo `pqCardHeader` vai para o cabeçalho:
 *
 *   <pq-card>
 *     <div pqCardHeader>Título</div>
 *     corpo
 *   </pq-card>
 */
@Component({
  selector: 'pq-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header"><ng-content select="[pqCardHeader]" /></header>
    <ng-content />
  `,
  styles: `
    :host {
      display: grid; gap: var(--pq-space-4);
      background: var(--pq-surface); border-radius: var(--pq-radius); padding: var(--pq-space-5);
    }
    :host([data-variant="inset"]) { background: var(--pq-surface-2); padding: var(--pq-space-3); }
    .header:empty { display: none; }
    .header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--pq-space-2); }
  `,
  host: { '[attr.data-variant]': 'variant()' },
})
export class Card {
  readonly variant = input<'default' | 'inset'>('default');
}
