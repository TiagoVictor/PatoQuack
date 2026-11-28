import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Label } from './label';

@Component({
  imports: [Label],
  template: `
    <pq-label id="a" for="name" required>Seu nome</pq-label>
    <pq-label id="b" tone="muted" size="sm">3 na sala</pq-label>
  `,
})
class Host {}

describe('Label', () => {
  it('com "for" vira um <label> associado; sem, é texto', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const formLabel = element.querySelector('#a label') as HTMLLabelElement;
    expect(formLabel.htmlFor).toBe('name');
    expect(formLabel.textContent).toBe('Seu nome');
    expect(element.querySelector('#a .required')).not.toBeNull();

    const text = element.querySelector('#b') as HTMLElement;
    expect(text.querySelector('label')).toBeNull();
    expect(text.textContent).toBe('3 na sala');
    expect(text.dataset['tone']).toBe('muted');
  });
});
