import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Button, ButtonVariant } from './button';

@Component({
  imports: [Button],
  template: `<button pqButton [variant]="variant()" [loading]="loading()" [pressed]="pressed()" block>Salvar</button>`,
})
class Host {
  readonly variant = signal<ButtonVariant>('primary');
  readonly loading = signal(false);
  readonly pressed = signal<boolean | null>(null);
}

describe('Button', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    return { fixture, button };
  }

  it('aplica variante e block mantendo o <button> nativo', async () => {
    const { button } = await render();
    expect(button.dataset['variant']).toBe('primary');
    expect(button.classList).toContain('block');
    expect(button.textContent).toContain('Salvar');
  });

  it('desabilita e mostra spinner durante loading', async () => {
    const { fixture, button } = await render();
    fixture.componentInstance.loading.set(true);
    await fixture.whenStable();

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('.spinner')).not.toBeNull();
  });

  it('só expõe aria-pressed em botões de alternância', async () => {
    const { fixture, button } = await render();
    expect(button.hasAttribute('aria-pressed')).toBe(false);

    fixture.componentInstance.pressed.set(true);
    await fixture.whenStable();
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });
});
