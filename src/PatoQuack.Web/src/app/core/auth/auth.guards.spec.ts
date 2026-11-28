import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { authGuard, safeReturnUrl } from './auth.guards';

describe('safeReturnUrl', () => {
  it('só aceita caminhos internos', () => {
    expect(safeReturnUrl('/s/1/c/2')).toBe('/s/1/c/2');
    expect(safeReturnUrl('https://malicioso.com')).toBe('/');
    expect(safeReturnUrl('//malicioso.com')).toBe('/');
    expect(safeReturnUrl(undefined)).toBe('/');
  });
});

describe('authGuard', () => {
  async function run(meStatus: number) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/convite/abcd2345' } as RouterStateSnapshot)) as Promise<boolean | UrlTree>;
    const me = http.expectOne('/api/auth/me');
    if (meStatus === 200) me.flush({ id: 'u1', name: 'Ana', email: 'a@b.dev', username: 'ana' });
    else me.flush(null, { status: meStatus, statusText: 'x' });
    return result;
  }

  it('deixa passar com sessão', async () => {
    expect(await run(200)).toBe(true);
  });

  it('sem sessão manda para o login guardando o destino', async () => {
    const result = await run(401);
    const router = TestBed.inject(Router);
    expect(router.serializeUrl(result as UrlTree)).toBe('/entrar?voltar=%2Fconvite%2Fabcd2345');
  });
});
