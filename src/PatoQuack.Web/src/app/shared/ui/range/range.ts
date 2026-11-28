import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

let nextId = 0;

/**
 * Controle deslizante com rótulo e valor ao lado.
 *   <pq-range label="Volume" [min]="0" [max]="100" [value]="vol()" suffix="%" (valueChange)="set($event)" />
 */
@Component({
  selector: 'pq-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="label" [for]="id">
      <span>{{ label() }}</span>
      <output [attr.for]="id">{{ value() }}{{ suffix() }}</output>
    </label>
    <input type="range" [id]="id" [min]="min()" [max]="max()" [step]="step()" [value]="value()"
           (input)="valueChange.emit(+$any($event.target).value)" />
  `,
  styles: `
    :host { display: grid; gap: 6px; }
    .label {
      display: flex; justify-content: space-between; font-size: .75rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: .04em; color: var(--pq-text-muted);
    }
    output { color: var(--pq-text); text-transform: none; }
    input { width: 100%; accent-color: var(--pq-accent); }
  `,
})
export class Range {
  readonly label = input.required<string>();
  readonly value = input(0);
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly suffix = input('');
  readonly valueChange = output<number>();

  protected readonly id = `pq-range-${++nextId}`;
}
