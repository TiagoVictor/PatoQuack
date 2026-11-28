import { ChangeDetectionStrategy, booleanAttribute, Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning';
export type ButtonSize = 'sm' | 'md';

/**
 * Botão do design system. É um componente de atributo para manter a semântica nativa
 * (type, disabled, foco, teclado, formulários):
 *
 *   <button pqButton variant="primary" type="submit" [loading]="joining()">Entrar</button>
 */
@Component({
  selector: 'button[pqButton], a[pqButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <span class="spinner" aria-hidden="true"></span>
    }
    <ng-content />
  `,
  styleUrl: './button.css',
  host: {
    class: 'pq-button',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[attr.data-align]': 'align()',
    '[class.block]': 'block()',
    '[attr.aria-busy]': 'loading() || null',
    '[attr.aria-pressed]': 'pressedAttr()',
    '[attr.disabled]': 'loading() || null',
  },
})
export class Button {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  /** Alinhamento do conteúdo (ex.: 'start' para itens de lista/navegação). */
  readonly align = input<'center' | 'start'>('center');
  /** Ocupa toda a largura disponível (ou divide o espaço numa linha flex). */
  readonly block = input(false, { transform: booleanAttribute });
  /** Mostra um indicador e desabilita o botão enquanto true. */
  readonly loading = input(false, { transform: booleanAttribute });
  /** Para botões de alternância (ex.: mutar). null = não é alternância. */
  readonly pressed = input<boolean | null>(null);

  protected readonly pressedAttr = computed(() => {
    const pressed = this.pressed();
    return pressed === null ? null : String(pressed);
  });
}
