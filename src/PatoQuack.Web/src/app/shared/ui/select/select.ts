import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
}

let nextId = 0;

/**
 * Seleção com rótulo (sobre o <select> nativo: teclado e leitores de tela de graça).
 *   <pq-select label="Microfone" [options]="mics()" [value]="micId()" (valueChange)="pick($event)" />
 */
@Component({
  selector: 'pq-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <label class="label" [for]="id">{{ label() }}</label>
    }
    <select [id]="id" [disabled]="disabled() || options().length === 0" [attr.aria-label]="label() ? null : ariaLabel()"
            (change)="onChange($event)">
      @for (option of options(); track option.value) {
        <option [value]="option.value" [selected]="option.value === value()">{{ option.label }}</option>
      } @empty {
        <option value="">{{ emptyText() }}</option>
      }
    </select>
  `,
  styles: `
    :host { display: grid; gap: 6px; min-width: 0; }
    .label { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--pq-text-muted); }
    select {
      width: 100%; min-width: 0; font: inherit; font-size: .9rem; color: var(--pq-text);
      background: var(--pq-bg); border: 1px solid transparent; border-radius: var(--pq-radius-sm); padding: 8px 10px;
    }
    select:focus-visible { outline: none; border-color: var(--pq-accent); }
    select:disabled { opacity: .6; }
  `,
})
export class Select<T extends string | number = string> {
  readonly options = input<readonly SelectOption<T>[]>([]);
  readonly value = input<T | null>(null);
  readonly label = input<string>();
  /** Rótulo para leitores de tela quando não há `label` visível. */
  readonly ariaLabel = input<string>();
  readonly emptyText = input('Nenhuma opção');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly valueChange = output<T>();

  protected readonly id = `pq-select-${++nextId}`;

  protected onChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const option = this.options().find((o) => String(o.value) === raw);
    if (option) this.valueChange.emit(option.value);
  }
}
