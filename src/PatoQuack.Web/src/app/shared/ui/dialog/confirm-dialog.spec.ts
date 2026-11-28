import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog } from './confirm-dialog';

@Component({
  imports: [ConfirmDialog],
  template: `
    <pq-confirm-dialog [open]="open()" heading="Excluir canal?" message="Não dá para desfazer."
                       confirmLabel="Excluir" danger (confirmed)="confirmed = confirmed + 1" (cancelled)="open.set(false)" />
  `,
})
class Host {
  readonly open = signal(false);
  confirmed = 0;
}

describe('ConfirmDialog', () => {
  beforeAll(() => {
    // O jsdom não implementa showModal/close do <dialog>.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });

  it('abre controlado pelo input e emite confirmar/cancelar', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const dialog = element.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(false);

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toContain('Não dá para desfazer.');

    const [cancel, confirm] = [...dialog.querySelectorAll('button')];
    expect(confirm.dataset['variant']).toBe('danger');
    confirm.click();
    expect(fixture.componentInstance.confirmed).toBe(1);

    cancel.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
