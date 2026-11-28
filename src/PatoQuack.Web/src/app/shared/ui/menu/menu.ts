import {
  ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, effect, inject, input, model, output,
} from '@angular/core';

/**
 * Painel suspenso preso a um gatilho (botão). Abre/fecha pelo `open` (two-way); fecha com Esc ou
 * clique fora. O conteúdo com `pqMenuTrigger` é o gatilho; o resto vai no painel.
 *
 *   <pq-menu [(open)]="micMenu" placement="top" label="Opções de voz">
 *     <button pqMenuTrigger pqButton (click)="micMenu.set(!micMenu())">˅</button>
 *     …conteúdo…
 *   </pq-menu>
 */
@Component({
  selector: 'pq-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[pqMenuTrigger]" />
    @if (open()) {
      <div class="panel" role="dialog" [attr.aria-label]="label()" [attr.data-placement]="placement()"
           [attr.data-align]="align()" [class.wide]="wide()">
        <ng-content />
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .panel {
      position: absolute; z-index: 30; min-width: 220px; max-width: min(340px, calc(100vw - 24px));
      max-height: min(70vh, 520px); overflow: auto;
      display: grid; gap: var(--pq-space-2); padding: var(--pq-space-3);
      background: var(--pq-surface-3, #111214); color: var(--pq-text);
      border-radius: var(--pq-radius); box-shadow: 0 8px 24px rgb(0 0 0 / .45);
    }
    .panel.wide { min-width: 300px; }
    .panel[data-placement="top"] { bottom: calc(100% + 8px); }
    .panel[data-placement="bottom"] { top: calc(100% + 8px); }
    .panel[data-align="start"] { left: 0; }
    .panel[data-align="end"] { right: 0; }
    .panel[data-align="center"] { left: 50%; transform: translateX(-50%); }
  `,
  host: {
    '(document:keydown.escape)': 'close()',
    '(document:pointerdown)': 'closeOnOutside($event)',
  },
})
export class Menu {
  readonly open = model(false);
  readonly placement = input<'top' | 'bottom'>('bottom');
  readonly align = input<'start' | 'center' | 'end'>('start');
  readonly wide = input(false, { transform: booleanAttribute });
  readonly label = input<string>();
  readonly opened = output<void>();
  readonly closed = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    let wasOpen = false;
    effect(() => {
      const open = this.open();
      if (open && !wasOpen) this.opened.emit();
      if (!open && wasOpen) this.closed.emit();
      wasOpen = open;
    });
  }

  close(): void {
    if (this.open()) this.open.set(false);
  }

  protected closeOnOutside(event: PointerEvent): void {
    if (this.open() && !this.host.contains(event.target as Node)) this.open.set(false);
  }
}

/**
 * Item clicável do menu: `<button pqMenuItem>`; `danger` pinta de vermelho.
 */
@Component({
  selector: 'button[pqMenuItem]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styles: `
    :host {
      display: flex; align-items: center; gap: var(--pq-space-2); width: 100%; text-align: left;
      font: inherit; font-size: .9rem; color: var(--pq-text); background: transparent; border: 0;
      border-radius: var(--pq-radius-sm); padding: 8px 10px; cursor: pointer; --pq-icon-size: 18px;
    }
    :host(:hover), :host(:focus-visible) { background: var(--pq-accent); outline: none; }
    :host(.danger) { color: var(--pq-danger); }
    :host(.danger:hover), :host(.danger:focus-visible) { background: var(--pq-danger); color: var(--pq-text); }
  `,
  host: { type: 'button', '[class.danger]': 'danger()' },
})
export class MenuItem {
  readonly danger = input(false, { transform: booleanAttribute });
}

/** Separador entre grupos de itens. */
@Component({
  selector: 'pq-menu-separator',
  template: '',
  styles: `:host { display: block; height: 1px; margin: 2px 0; background: rgb(255 255 255 / .08); }`,
  host: { role: 'separator' },
})
export class MenuSeparator {}
