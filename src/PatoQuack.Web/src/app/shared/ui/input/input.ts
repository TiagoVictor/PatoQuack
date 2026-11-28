import { Directive } from '@angular/core';

/**
 * Estilo padrão de campo de texto. É uma diretiva sobre o <input> nativo, então funciona com
 * formulários reativos, validação nativa e autocomplete sem nenhum adaptador:
 *
 *   <input pqInput id="name" formControlName="name" />
 */
@Directive({
  selector: 'input[pqInput], textarea[pqInput]',
  host: { class: 'pq-input' },
})
export class TextInput {}
