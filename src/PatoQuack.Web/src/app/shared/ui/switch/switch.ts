import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';

let nextId = 0;

/**
 * Linha liga/desliga com texto e descrição opcional (checkbox nativo com aparência de interruptor).
 *   <pq-switch label="Assistir automaticamente" [checked]="autoWatch()" (checkedChange)="set($event)" />
 */
@Component({
  selector: 'pq-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [for]="id" class="text">
      <span>{{ label() }}</span>
      @if (description()) {
        <small>{{ description() }}</small>
      }
    </label>
    <input type="checkbox" role="switch" [id]="id" [checked]="checked()" [disabled]="disabled()"
           (change)="checkedChange.emit($any($event.target).checked)" />
  `,
  styles: `
    :host { display: flex; align-items: center; justify-content: space-between; gap: var(--pq-space-3); padding: 4px 2px; }
    .text { display: grid; gap: 2px; font-size: .9rem; cursor: pointer; }
    small { color: var(--pq-text-muted); font-size: .75rem; }
    input {
      appearance: none; flex: none; width: 36px; height: 20px; border-radius: 999px; cursor: pointer;
      background: var(--pq-bg); position: relative; transition: background .12s ease;
    }
    input::after {
      content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: var(--pq-text-muted); transition: transform .12s ease, background .12s ease;
    }
    input:checked { background: var(--pq-success); }
    input:checked::after { transform: translateX(16px); background: var(--pq-text); }
    input:focus-visible { outline: 2px solid var(--pq-accent); outline-offset: 2px; }
    input:disabled { opacity: .5; cursor: not-allowed; }
  `,
})
export class Switch {
  readonly label = input.required<string>();
  readonly description = input<string>();
  readonly checked = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly checkedChange = output<boolean>();

  protected readonly id = `pq-switch-${++nextId}`;
}
