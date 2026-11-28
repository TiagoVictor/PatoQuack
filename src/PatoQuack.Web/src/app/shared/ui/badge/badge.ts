import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** Pílula curta de status: <pq-badge tone="success">conectado</pq-badge> */
@Component({
  selector: 'pq-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex; align-items: center; white-space: nowrap;
      font-size: .72rem; padding: 2px 8px; border-radius: 999px;
      background: var(--pq-bg); color: var(--pq-text-muted);
    }
    :host([data-tone="accent"]) { background: var(--pq-accent); color: var(--pq-text); }
    :host([data-tone="success"]) { color: var(--pq-success); }
    :host([data-tone="warning"]) { color: var(--pq-warning); }
    :host([data-tone="danger"]) { color: var(--pq-danger); }
  `,
  host: { '[attr.data-tone]': 'tone()' },
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
}
