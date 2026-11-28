import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { Button } from '../button/button';
import { Label } from '../label/label';
import { Dialog } from './dialog';

/**
 * Confirmação de uma ação (ex.: excluir). `danger` pinta o botão de confirmar de vermelho.
 *
 *   <pq-confirm-dialog [open]="deleting()" heading="Excluir canal?" message="..." confirmLabel="Excluir"
 *                      danger [busy]="busy()" (confirmed)="deleteAsync()" (cancelled)="deleting.set(false)" />
 */
@Component({
  selector: 'pq-confirm-dialog',
  imports: [Button, Dialog, Label],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-dialog [open]="open()" [heading]="heading()" (closed)="cancelled.emit()">
      <p class="message">{{ message() }}</p>
      @if (error()) {
        <pq-label tone="danger" size="sm" role="alert">{{ error() }}</pq-label>
      }
      <div pqDialogActions>
        <button pqButton type="button" (click)="cancelled.emit()">Cancelar</button>
        <button pqButton type="button" [variant]="danger() ? 'danger' : 'primary'" [loading]="busy()"
                (click)="confirmed.emit()">{{ confirmLabel() }}</button>
      </div>
    </pq-dialog>
  `,
  styles: `.message { margin: 0; }`,
})
export class ConfirmDialog {
  readonly open = input(false, { transform: booleanAttribute });
  readonly heading = input.required<string>();
  readonly message = input('');
  readonly confirmLabel = input('Confirmar');
  readonly danger = input(false, { transform: booleanAttribute });
  readonly busy = input(false, { transform: booleanAttribute });
  readonly error = input<string | null>(null);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
