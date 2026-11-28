import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { HomePage } from './home-page';

describe('HomePage', () => {
  async function render(servers: unknown[] = []) {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HomePage);
    http.expectOne('/api/servers').flush(servers);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const type = async (selector: string, value: string) => {
      const input = element.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const submit = async (id: string) => {
      element.querySelector(`#${id}`)!.closest('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    };
    return { fixture, element, navigate, http, type, submit };
  }

  it('lista os servidores do usuário marcando os que ele é dono', async () => {
    const { element } = await render([
      { id: 's1', name: 'Amigos', isOwner: true },
      { id: 's2', name: 'Trabalho', isOwner: false },
    ]);

    const links = [...element.querySelectorAll('a[pqbutton]')].map((a) => a.textContent?.replace(/\s+/g, ''));
    expect(links).toEqual(['AAmigosdono', 'TTrabalho']);
  });

  it('cria o servidor e vai para o canal padrão', async () => {
    const { navigate, type, submit, http, fixture } = await render();

    await type('#server-name', ' Amigos ');
    await submit('server-name');
    const request = http.expectOne('/api/servers');
    expect(request.request.body).toEqual({ name: 'Amigos' });
    request.flush({ id: 's1', name: 'Amigos', isOwner: true, permissions: [], channels: [{ id: 'c1', name: 'geral' }] });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/s', 's1', 'c', 'c1']);
  });

  it('abre o convite a partir do link e valida o código', async () => {
    const { element, navigate, type, submit } = await render();

    await type('#invite', 'nada');
    await submit('invite');
    expect(element.textContent).toContain('Cole o código');
    expect(navigate).not.toHaveBeenCalled();

    await type('#invite', 'http://localhost:4200/convite/ABCD2345');
    await submit('invite');
    expect(navigate).toHaveBeenCalledWith(['/convite', 'abcd2345']);
  });
});
