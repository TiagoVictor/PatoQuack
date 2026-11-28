import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { StatusEntry } from '../data/voice-room.models';

/** Histórico recolhível de mensagens de status. */
@Component({
  selector: 'pq-activity-log',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details>
      <summary>Log</summary>
      <ol>
        @for (entry of entries(); track entry.id) {
          <li [attr.data-level]="entry.level">{{ entry.at | date: 'HH:mm:ss' }}  {{ entry.message }}</li>
        }
      </ol>
    </details>
  `,
  styles: `
    summary { cursor: pointer; color: var(--pq-text-muted); font-size: .85rem; }
    ol {
      list-style: none; margin: 8px 0 0; padding: 10px; border-radius: 8px;
      background: var(--pq-surface); max-height: 200px; overflow: auto;
      font: .75rem/1.5 var(--pq-font-mono); color: var(--pq-text-muted); white-space: pre-wrap;
    }
    li[data-level="warn"] { color: var(--pq-warning); }
    li[data-level="error"] { color: var(--pq-danger); }
  `,
})
export class ActivityLog {
  readonly entries = input<readonly StatusEntry[]>([]);
}
