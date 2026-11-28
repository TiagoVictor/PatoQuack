import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Menu, MenuItem } from './menu';

@Component({
  imports: [Menu, MenuItem],
  template: `
    <pq-menu [(open)]="open" label="Opções">
      <button pqMenuTrigger id="trigger" (click)="open.set(!open())">˅</button>
      <button pqMenuItem id="item">Item</button>
    </pq-menu>
    <p id="outside">fora</p>
  `,
})
class Host {
  readonly open = signal(false);
}

describe('Menu', () => {
  it('abre pelo gatilho e fecha com Esc ou clique fora', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#item')).toBeNull();

    (el.querySelector('#trigger') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Opções');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    el.querySelector('#outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
