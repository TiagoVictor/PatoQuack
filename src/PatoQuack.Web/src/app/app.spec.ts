import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { DEFAULT_VOICE_CONFIG, VOICE_CONFIG } from './core/config/voice.config';

describe('App', () => {
  it('mostra a marca com link para o início', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        // URL absoluta: no jsdom não há origem para resolver a relativa. Nada conecta no teste.
        { provide: VOICE_CONFIG, useValue: { ...DEFAULT_VOICE_CONFIG, hubUrl: 'http://localhost/hubs/voice' } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('PatoQuack');
    expect(element.querySelector('a.home-link')?.getAttribute('href')).toBe('/');
    expect(element.querySelector('.account')).toBeNull(); // sem sessão
  });
});
