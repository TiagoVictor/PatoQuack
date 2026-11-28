import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Select } from './select';

@Component({
  imports: [Select],
  template: `<pq-select label="FPS" [options]="options" [value]="value()" (valueChange)="value.set($event)" />`,
})
class Host {
  readonly options = [{ value: 15, label: '15 FPS' }, { value: 30, label: '30 FPS' }];
  readonly value = signal(15);
}

describe('Select', () => {
  it('marca o valor atual e devolve o valor tipado escolhido', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const select = (fixture.nativeElement as HTMLElement).querySelector('select')!;
    expect(select.selectedOptions[0].textContent).toBe('15 FPS');
    expect((fixture.nativeElement as HTMLElement).querySelector('label')?.textContent).toBe('FPS');

    select.value = '30';
    select.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.value()).toBe(30);
  });
});
