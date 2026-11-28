import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Grid, GridItem } from './grid';

interface Item { id: number; name: string }

@Component({
  imports: [Grid, GridItem],
  template: `
    <pq-grid [items]="items()" [trackBy]="byId" minItemWidth="120px" emptyText="Ninguém aqui">
      <ng-template pqGridItem [pqGridItemOf]="items()" let-item let-i="index">
        <span class="item">{{ i }}:{{ item.name }}</span>
      </ng-template>
    </pq-grid>
  `,
})
class Host {
  readonly items = signal<Item[]>([{ id: 1, name: 'Ana' }, { id: 2, name: 'Bia' }]);
  readonly byId = (item: Item) => item.id;
}

@Component({
  imports: [Grid],
  template: `<pq-grid><div class="free">a</div><div class="free">b</div></pq-grid>`,
})
class LayoutHost {}

describe('Grid', () => {
  it('renderiza cada item com o template e expõe a largura mínima', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    const texts = [...element.querySelectorAll('.item')].map((e) => e.textContent);
    expect(texts).toEqual(['0:Ana', '1:Bia']);
    expect(element.querySelector('pq-grid')?.getAttribute('role')).toBe('list');
    const host = element.querySelector('pq-grid') as HTMLElement;
    expect(host.style.getPropertyValue('--min-item')).toBe('120px');
    expect(host.style.getPropertyValue('--fill')).toBe('auto-fill');
  });

  it('mostra o texto de vazio quando não há itens', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.items.set([]);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.empty')?.textContent).toContain('Ninguém aqui');
  });

  it('funciona só como layout, projetando o conteúdo', async () => {
    const fixture = TestBed.createComponent(LayoutHost);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.free').length).toBe(2);
    expect(element.querySelector('pq-grid')?.hasAttribute('role')).toBe(false);
  });
});
