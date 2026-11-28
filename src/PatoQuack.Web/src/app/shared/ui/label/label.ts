import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, booleanAttribute, Component, input } from '@angular/core';

export type LabelTone = 'default' | 'muted' | 'success' | 'warning' | 'danger';
export type LabelSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Texto com tom e tamanho padronizados. Com `for`, vira um <label> de formulário; sem, é um
 * texto (span) — útil para legendas, contadores e nomes.
 *
 *   <pq-label for="name" required>Seu nome</pq-label>
 *   <pq-label tone="muted" size="sm">3 na sala</pq-label>
 */
@Component({
  selector: 'pq-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  // ng-content só pode aparecer uma vez; o template permite usá-lo nos dois ramos.
  template: `
    <ng-template #content><ng-content /></ng-template>
    @if (for()) {
      <label [attr.for]="for()"><ng-container [ngTemplateOutlet]="content" /></label>
    } @else {
      <ng-container [ngTemplateOutlet]="content" />
    }
    @if (required()) {
      <span class="required" aria-hidden="true">*</span>
    }
  `,
  styles: `
    :host { display: inline; font-size: .95rem; color: var(--pq-text); }
    :host([data-size="xs"]) { font-size: .72rem; }
    :host([data-size="sm"]) { font-size: .85rem; }
    :host([data-size="lg"]) { font-size: 1.2rem; }
    :host([data-tone="muted"]) { color: var(--pq-text-muted); }
    :host([data-tone="success"]) { color: var(--pq-success); }
    :host([data-tone="warning"]) { color: var(--pq-warning); }
    :host([data-tone="danger"]) { color: var(--pq-danger); }
    :host(.strong) { font-weight: 600; }
    :host(.truncate) { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    label { cursor: pointer; }
    .required { color: var(--pq-danger); margin-left: 2px; }
  `,
  host: {
    '[attr.data-tone]': 'tone()',
    '[attr.data-size]': 'size()',
    '[class.strong]': 'strong() || !!for()',
    '[class.truncate]': 'truncate()',
  },
})
export class Label {
  /** Id do controle associado. Quando informado, renderiza um <label>. */
  readonly for = input<string>();
  readonly tone = input<LabelTone>('default');
  readonly size = input<LabelSize>('md');
  readonly strong = input(false, { transform: booleanAttribute });
  readonly required = input(false, { transform: booleanAttribute });
  /** Corta com reticências em uma linha. */
  readonly truncate = input(false, { transform: booleanAttribute });
}
