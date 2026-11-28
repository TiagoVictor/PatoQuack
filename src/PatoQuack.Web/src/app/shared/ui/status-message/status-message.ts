import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusLevel = 'info' | 'warn' | 'error';

/** Mensagem de status anunciada por leitores de tela (role="status" / "alert"). */
@Component({
  selector: 'pq-status-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styles: `
    :host { display: block; margin: 0; min-height: 1.4em; font-size: .9rem; color: var(--pq-text-muted); }
    :host([data-level="warn"]) { color: var(--pq-warning); }
    :host([data-level="error"]) { color: var(--pq-danger); }
  `,
  host: {
    '[attr.data-level]': 'level()',
    '[attr.role]': 'level() === "error" ? "alert" : "status"',
  },
})
export class StatusMessage {
  readonly level = input<StatusLevel>('info');
}
