import { ChangeDetectionStrategy, booleanAttribute, Component, input } from '@angular/core';
import { Label } from '../label/label';

/**
 * Campo de formulário: label + controle (projetado) + dica ou erro.
 *
 *   <pq-form-field label="Sala" for="room" hint="Letras, números, - ou _" [error]="roomError()">
 *     <input pqInput id="room" formControlName="room" />
 *   </pq-form-field>
 */
@Component({
  selector: 'pq-form-field',
  imports: [Label],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pq-label [for]="for()" tone="muted" size="sm" [required]="required()">{{ label() }}</pq-label>
    <ng-content />
    @if (error()) {
      <pq-label tone="danger" size="xs" role="alert">{{ error() }}</pq-label>
    } @else if (hint()) {
      <pq-label tone="muted" size="xs">{{ hint() }}</pq-label>
    }
  `,
  styles: `:host { display: grid; gap: 6px; }`,
})
export class FormField {
  readonly label = input.required<string>();
  readonly for = input.required<string>();
  readonly hint = input<string>();
  readonly error = input<string | null>();
  readonly required = input(false, { transform: booleanAttribute });
}
