import {
  ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild,
} from '@angular/core';

/**
 * Diálogo modal sobre o <dialog> nativo (foco preso, Esc fecha, fundo escurecido).
 * Controlado por `open`; avisa com `closed` quando a pessoa fecha (Esc, clique fora ou botão).
 *
 *   <pq-dialog [open]="editing()" heading="Renomear" (closed)="editing.set(false)">
 *     corpo
 *     <div pqDialogActions>botões</div>
 *   </pq-dialog>
 */
@Component({
  selector: 'pq-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog [attr.aria-labelledby]="headingId" (close)="closed.emit()" (click)="closeOnBackdrop($event)">
      <div class="panel">
        <h2 class="heading" [id]="headingId">{{ heading() }}</h2>
        <div class="body"><ng-content /></div>
        <div class="actions"><ng-content select="[pqDialogActions]" /></div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      padding: 0; border: 0; border-radius: var(--pq-radius); width: min(420px, calc(100vw - 32px));
      background: var(--pq-surface); color: var(--pq-text);
    }
    dialog::backdrop { background: rgb(0 0 0 / .6); }
    .panel { display: grid; gap: var(--pq-space-4); padding: var(--pq-space-5); }
    .heading { margin: 0; font-size: 1.15rem; }
    .body { display: grid; gap: var(--pq-space-3); color: var(--pq-text-muted); }
    .actions:empty { display: none; }
    .actions { display: flex; justify-content: flex-end; gap: var(--pq-space-2); }
  `,
})
export class Dialog {
  private static nextId = 0;

  readonly open = input(false);
  readonly heading = input.required<string>();
  readonly closed = output<void>();

  protected readonly headingId = `pq-dialog-${++Dialog.nextId}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) element.showModal();
      else if (!this.open() && element.open) element.close();
    });
  }

  /** Clique no fundo (fora do painel) fecha. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
