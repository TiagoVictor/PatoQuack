import { ChangeDetectionStrategy, Component, booleanAttribute, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Button } from '../button/button';
import { FormField } from '../form-field/form-field';
import { TextInput } from '../input/input';
import { Dialog } from './dialog';

/**
 * Pede um texto (ex.: renomear). Abre preenchido com `value` e emite `submitted` com o texto
 * sem espaços nas pontas.
 */
@Component({
  selector: 'pq-prompt-dialog',
  imports: [ReactiveFormsModule, Button, Dialog, FormField, TextInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-dialog [open]="open()" [heading]="heading()" (closed)="cancelled.emit()">
      <form [formGroup]="form" (ngSubmit)="submit()" id="{{ formId }}">
        <pq-form-field [label]="label()" [for]="inputId" required [error]="error()">
          <input pqInput [id]="inputId" formControlName="value" [attr.maxlength]="maxLength()" autocomplete="off" />
        </pq-form-field>
      </form>
      <div pqDialogActions>
        <button pqButton type="button" (click)="cancelled.emit()">Cancelar</button>
        <button pqButton type="submit" [attr.form]="formId" variant="primary" [loading]="busy()">{{ confirmLabel() }}</button>
      </div>
    </pq-dialog>
  `,
})
export class PromptDialog {
  private static nextId = 0;

  readonly open = input(false, { transform: booleanAttribute });
  readonly heading = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input('');
  readonly confirmLabel = input('Salvar');
  readonly maxLength = input(32);
  readonly busy = input(false, { transform: booleanAttribute });
  readonly error = input<string | null>(null);
  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly formId = `pq-prompt-${++PromptDialog.nextId}`;
  protected readonly inputId = `${this.formId}-input`;
  protected readonly form = new FormGroup({
    value: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/)] }),
  });

  constructor() {
    // Cada vez que abre, começa com o valor atual.
    effect(() => {
      if (this.open()) this.form.reset({ value: this.value() });
    });
  }

  protected submit(): void {
    if (this.form.invalid) return;
    this.submitted.emit(this.form.controls.value.value.trim());
  }
}
