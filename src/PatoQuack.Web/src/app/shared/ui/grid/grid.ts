import {
  ChangeDetectionStrategy, Component, Directive, TemplateRef, contentChild, input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

export interface GridItemContext<T> {
  $implicit: T;
  index: number;
}

/**
 * Template de cada item do <pq-grid>:
 *   <ng-template pqGridItem let-item let-i="index">…</ng-template>
 */
@Directive({ selector: 'ng-template[pqGridItem]' })
export class GridItem<T> {
  readonly pqGridItemOf = input<readonly T[]>();

  constructor(readonly template: TemplateRef<GridItemContext<T>>) {}

  /** Tipa o `let-item` no template a partir de [pqGridItemOf]. */
  static ngTemplateContextGuard<T>(_dir: GridItem<T>, ctx: unknown): ctx is GridItemContext<T> {
    return true;
  }
}

/**
 * Grade responsiva genérica: as colunas se ajustam à largura (auto-fill com largura mínima).
 *
 * Com dados:
 *   <pq-grid [items]="people()" [trackBy]="byId" minItemWidth="180px" emptyText="Ninguém aqui">
 *     <ng-template pqGridItem let-person>{{ person.name }}</ng-template>
 *   </pq-grid>
 *
 * Ou só como layout, projetando o conteúdo:
 *   <pq-grid minItemWidth="280px" fill="auto-fit"><div>a</div><div>b</div></pq-grid>
 */
@Component({
  selector: 'pq-grid',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (itemTemplate(); as template) {
      @for (item of items(); track trackBy()(item, $index); let i = $index) {
        <div class="cell" role="listitem">
          <ng-container *ngTemplateOutlet="template.template; context: { $implicit: item, index: i }" />
        </div>
      } @empty {
        @if (emptyText()) {
          <p class="empty">{{ emptyText() }}</p>
        }
      }
    } @else {
      <ng-content />
    }
  `,
  styles: `
    :host {
      display: grid; gap: var(--gap);
      grid-template-columns: repeat(var(--fill), minmax(min(var(--min-item), 100%), 1fr));
    }
    .cell { min-width: 0; display: grid; }
    .empty { grid-column: 1 / -1; margin: 0; color: var(--pq-text-muted); font-size: .9rem; }
  `,
  host: {
    '[attr.role]': 'itemTemplate() ? "list" : null',
    '[style.--min-item]': 'minItemWidth()',
    '[style.--gap]': 'gap()',
    '[style.--fill]': 'fill()',
  },
})
export class Grid<T> {
  readonly items = input<readonly T[]>([]);
  /** Chave estável de cada item (padrão: o índice). */
  readonly trackBy = input<(item: T, index: number) => unknown>((_item, index) => index);
  readonly minItemWidth = input('200px');
  readonly gap = input('var(--pq-space-2)');
  readonly emptyText = input<string>();
  /**
   * 'auto-fill' mantém o tamanho das células mesmo com poucos itens (sobram colunas vazias);
   * 'auto-fit' estica os itens para ocupar a linha (bom para layout de poucos blocos).
   */
  readonly fill = input<'auto-fill' | 'auto-fit'>('auto-fill');

  protected readonly itemTemplate = contentChild<GridItem<T>>(GridItem);
}
