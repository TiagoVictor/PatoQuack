import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Medidor de nível em segmentos (ex.: microfone). `level` vai de 0 a 1. */
@Component({
  selector: 'pq-level-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (on of segments(); track $index) {
      <span [class.on]="on"></span>
    }
  `,
  styles: `
    :host { display: grid; grid-auto-flow: column; gap: 2px; height: 10px; }
    span { border-radius: 2px; background: var(--pq-bg); }
    span.on { background: var(--pq-success); }
  `,
  host: {
    role: 'meter',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'percent()',
    '[attr.aria-label]': 'label()',
  },
})
export class LevelMeter {
  readonly level = input(0);
  readonly count = input(24);
  readonly label = input('Nível');

  protected readonly percent = computed(() => Math.round(Math.min(1, Math.max(0, this.level())) * 100));
  protected readonly segments = computed(() => {
    const lit = Math.round(Math.min(1, Math.max(0, this.level())) * this.count());
    return Array.from({ length: this.count() }, (_, i) => i < lit);
  });
}
